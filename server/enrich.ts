/**
 * Brand details for an Outbid listing: name, description and icon, fetched once from the listing's
 * own site after a payment is confirmed — never on the swipe path, never while a viewer waits.
 *
 * Cost control: one HTML fetch capped at 150 KB, one icon fetch capped at 200 KB, regex parsing
 * (no DOM), 6s/5s timeouts. The icon is stored in R2 and served from our own edge cache, so
 * visitors never hit the brand's server and a slow site can't slow the board.
 *
 * Safety: only public https(s) URLs (the Worker has global_fetch_strictly_public), only image
 * content types are stored, and all text is stripped of markup and clamped before it is saved.
 */

const HTML_TIMEOUT_MS = 6_000;
const ICON_TIMEOUT_MS = 5_000;
const MAX_HTML_BYTES = 64_000; // the <head> is near the top; less decoding = less CPU
const MAX_ICON_BYTES = 200_000;
const MAX_NAME = 70;
const MAX_DESC = 160;
const UA = "OutvidsBot/1.0 (+https://outvids.lol/about)";

export type EnrichResult = {
  /** Raw, pre-clean strings — only returned by the token-protected debug flag. */
  raw?: { title?: string; description?: string };
  listing_key: string;
  status: "ok" | "partial" | "failed";
  name: string | null;
  description: string | null;
  icon_key: string | null;
  icon_type: string | null;
  icon_bytes: number | null;
  source_url: string;
  error: string | null;
  ms: number;
};

const ICON_EXT: Record<string, string> = {
  "image/png": "png",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
  "image/svg+xml": "svg",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  rsquo: "\u2019", lsquo: "\u2018", rdquo: "\u201d", ldquo: "\u201c", sbquo: "\u201a", bdquo: "\u201e",
  mdash: "\u2014", ndash: "\u2013", minus: "\u2212", shy: "", hellip: "\u2026", middot: "\u00b7", bull: "\u2022",
  trade: "\u2122", copy: "\u00a9", reg: "\u00ae", deg: "\u00b0", times: "\u00d7", divide: "\u00f7",
  plusmn: "\u00b1", frac12: "\u00bd", euro: "\u20ac", pound: "\u00a3", yen: "\u00a5", cent: "\u00a2",
  eacute: "\u00e9", egrave: "\u00e8", agrave: "\u00e0", ccedil: "\u00e7", uuml: "\u00fc", ouml: "\u00f6",
  auml: "\u00e4", szlig: "\u00df", ntilde: "\u00f1", aacute: "\u00e1", iacute: "\u00ed", oacute: "\u00f3",
  uacute: "\u00fa", larr: "\u2190", rarr: "\u2192", harr: "\u2194", star: "\u2605",
};

/** Plain text from an HTML attribute value: entities decoded, markup dropped, whitespace collapsed. */
function clean(value: string | undefined, max: number): string | null {
  if (!value) return null;
  let t = value.replace(/<[^>]*>/g, " ");
  t = t.replace(/&#x([0-9a-f]+);/gi, (_, h) => codePoint(parseInt(h, 16)));
  t = t.replace(/&#(\d+);/g, (_, d) => codePoint(Number(d)));
  // Known names become their character; anything else is dropped rather than turned into a space,
  // which would split words like "iRoamly&rsquo;s" into "iRoamly s".
  t = t.replace(
    /&([a-z][a-z0-9]{1,10});/gi,
    (_, name) => ENTITIES[String(name).toLowerCase()] ?? "",
  );
  t = t.replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

const codePoint = (n: number) => {
  try {
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
  } catch {
    return "";
  }
};

// Compiled once per attribute name, not once per tag: building RegExps in a loop was the whole CPU cost.
const ATTR_RE = new Map<string, RegExp>();
function attr(tag: string, name: string) {
  let re = ATTR_RE.get(name);
  if (!re) {
    re = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
    ATTR_RE.set(name, re);
  }
  const m = re.exec(tag);
  return m ? (m[2] ?? m[3] ?? m[4]) : undefined;
}

/** Read at most `limit` bytes of a response body. */
async function readCapped(res: Response, limit: number): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  reader.cancel().catch(() => {});
  const out = new Uint8Array(Math.min(size, limit));
  let at = 0;
  for (const c of chunks) {
    if (at >= out.length) break;
    out.set(c.subarray(0, out.length - at), at);
    at += c.length;
  }
  return out;
}

const slug = (key: string) =>
  key.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 100);

export async function enrichListing(
  env: CloudflareEnv,
  listingKey: string,
  link: string,
): Promise<EnrichResult> {
  const started = Date.now();
  const base: EnrichResult = {
    listing_key: listingKey,
    status: "failed",
    name: null,
    description: null,
    icon_key: null,
    icon_type: null,
    icon_bytes: null,
    source_url: link,
    error: null,
    ms: 0,
  };

  let html = "";
  let finalUrl = link;
  try {
    const res = await fetch(link, {
      headers: {
        "user-agent": UA,
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(HTML_TIMEOUT_MS),
    });
    finalUrl = res.url || link;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = res.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml/i.test(type))
      throw new Error(`not html (${type.split(";")[0] || "unknown"})`);
    html = new TextDecoder("utf-8", { fatal: false }).decode(
      await readCapped(res, MAX_HTML_BYTES),
    );
  } catch (err) {
    return {
      ...base,
      source_url: finalUrl,
      error: msg(err),
      ms: Date.now() - started,
    };
  }

  // ── parse (head only: everything we need is there, and it keeps the regex work small)
  const head = html.slice(0, html.search(/<\/head>/i) + 1 || html.length);
  const metas = head.match(/<meta\b[^>]*>/gi) ?? [];
  // One pass over the tags; after this, picking a key is a map lookup.
  const metaByKey = new Map<string, string>();
  for (const tag of metas) {
    const key = (attr(tag, "property") ?? attr(tag, "name") ?? "").toLowerCase();
    if (!key || metaByKey.has(key)) continue;
    const content = attr(tag, "content");
    if (content) metaByKey.set(key, content);
  }
  const pick = (keys: string[]) => {
    for (const key of keys) {
      const v = clean(metaByKey.get(key), key.includes("desc") ? MAX_DESC : MAX_NAME);
      if (v) return v;
    }
    return null;
  };

  const host = safeHost(finalUrl);
  const name =
    pick(["og:site_name", "application-name", "apple-mobile-web-app-title"]) ??
    clean(/<title[^>]*>([\s\S]{0,300})<\/title>/i.exec(head)?.[1], MAX_NAME) ??
    pick(["og:title", "twitter:title"]) ??
    host;
  const description = pick([
    "og:description",
    "description",
    "twitter:description",
  ]);

  // ── icon: prefer a big apple-touch-icon, then the largest declared icon, then /favicon.ico
  const links = head.match(/<link\b[^>]*>/gi) ?? [];
  const candidates: { url: string; score: number }[] = [];
  for (const tag of links) {
    const rel = (attr(tag, "rel") || "").toLowerCase();
    const href = attr(tag, "href");
    if (!href || !/icon/.test(rel) || /mask-icon/.test(rel)) continue;
    const size = Math.max(
      0,
      ...(attr(tag, "sizes") || "")
        .split(/\s+/)
        .map((s) => parseInt(s, 10) || 0),
    );
    const score = (/apple-touch/.test(rel) ? 300 : 0) + (size || 32);
    try {
      candidates.push({ url: new URL(href, finalUrl).toString(), score });
    } catch {}
  }
  try {
    candidates.push({
      url: new URL("/favicon.ico", finalUrl).toString(),
      score: 1,
    });
  } catch {}
  candidates.sort((a, b) => b.score - a.score);
  if (host) {
    candidates.push({
      url: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`,
      score: 0,
    });
  }

  let icon: { key: string; type: string; bytes: number } | null = null;
  let iconError: string | null = null;
  for (const c of candidates.slice(0, 4)) {
    try {
      const res = await fetch(c.url, {
        headers: { "user-agent": UA, accept: "image/*" },
        redirect: "follow",
        signal: AbortSignal.timeout(ICON_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const type = (res.headers.get("content-type") || "")
        .split(";")[0]
        .trim()
        .toLowerCase();
      const ext = ICON_EXT[type];
      if (!ext) throw new Error(`type ${type || "unknown"}`);
      const bytes = await readCapped(res, MAX_ICON_BYTES);
      if (bytes.length < 60) throw new Error("too small");
      const key = `brand-icons/${slug(listingKey)}.${ext}`;
      await env.CLIPS.put(key, bytes, {
        httpMetadata: {
          contentType: type,
          cacheControl: "public, max-age=604800",
        },
      });
      icon = { key, type, bytes: bytes.length };
      break;
    } catch (err) {
      iconError = msg(err);
    }
  }

  const status: EnrichResult["status"] = icon && name ? "ok" : "partial";
  return {
    ...base,
    raw: {
      title: /<title[^>]*>([\s\S]{0,120})<\/title>/i.exec(head)?.[1],
      description: metaByKey.get("description") ?? metaByKey.get("og:description"),
    },
    status,
    name,
    description,
    icon_key: icon?.key ?? null,
    icon_type: icon?.type ?? null,
    icon_bytes: icon?.bytes ?? null,
    source_url: finalUrl,
    error: icon ? null : iconError,
    ms: Date.now() - started,
  };
}

/** Fetch + store. Safe to call repeatedly; the newest result replaces the old row. */
export async function enrichAndSave(
  env: CloudflareEnv,
  listingKey: string,
  link: string,
) {
  const r = await enrichListing(env, listingKey, link);
  await env.DB.prepare(
    `INSERT INTO listing_meta (listing_key, name, description, icon_key, icon_type, icon_bytes, source_url, status, error, attempts, fetched_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, ?10)
     ON CONFLICT (listing_key) DO UPDATE SET
       name = ?2, description = ?3, icon_key = ?4, icon_type = ?5, icon_bytes = ?6,
       source_url = ?7, status = ?8, error = ?9, attempts = listing_meta.attempts + 1, fetched_at = ?10`,
  )
    .bind(
      listingKey,
      r.name,
      r.description,
      r.icon_key,
      r.icon_type,
      r.icon_bytes,
      r.source_url,
      r.status,
      r.error,
      Date.now(),
    )
    .run();
  return r;
}

/** Cron: fill in listings that are paid but have no details yet (or whose fetch failed, up to 3 tries). */
export async function enrichPending(env: CloudflareEnv, limit = 10) {
  const { results } = await env.DB.prepare(
    `SELECT b.listing_key AS k, MAX(b.link) AS link
       FROM bids b LEFT JOIN listing_meta m ON m.listing_key = b.listing_key
      WHERE b.status = 'paid' AND (m.listing_key IS NULL OR (m.status = 'failed' AND m.attempts < 3))
      GROUP BY b.listing_key
      LIMIT ?`,
  )
    .bind(limit)
    .all<{ k: string; link: string }>();

  const done: { key: string; status: string; ms: number }[] = [];
  for (const row of results) {
    try {
      const r = await enrichAndSave(env, row.k, row.link);
      done.push({ key: row.k, status: r.status, ms: r.ms });
    } catch (err) {
      done.push({ key: row.k, status: `error: ${msg(err)}`, ms: 0 });
    }
  }
  return done;
}

const msg = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).slice(0, 200);
const safeHost = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
};
