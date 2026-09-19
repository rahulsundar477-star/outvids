/**
 * Brand details for an Outbid listing: name, description and icon, fetched once from the listing's
 * own site after a payment is confirmed — never on the swipe path, never while a viewer waits.
 *
 * Cost control: one HTML fetch capped at 64 KB, at most four icon downloads capped at 300 KB each,
 * regex parsing (no DOM), 6s/5s timeouts. Icon quality is read from the file header, so the board
 * gets a 128px+ logo where the site has one instead of a 16px favicon. The icon is stored in R2 and
 * served from our own edge cache, so visitors never hit the brand's server.
 *
 * Safety: only public https(s) URLs (the Worker has global_fetch_strictly_public), only image
 * content types are stored, and all text is stripped of markup and clamped before it is saved.
 */

const HTML_TIMEOUT_MS = 8_000;
const ICON_TIMEOUT_MS = 5_000;
const MANIFEST_TIMEOUT_MS = 4_000;
const MAX_HTML_BYTES = 64_000; // the <head> is near the top; less decoding = less CPU
const MAX_ICON_BYTES = 300_000;
const MAX_MANIFEST_BYTES = 32_000;
/** The board draws the icon at 52px, so 2x screens need 104px. Anything at least this wide wins outright. */
const GOOD_ICON_PX = 128;
/** Hard cap on icon downloads per listing, so a site with ten declared icons can't cost ten fetches. */
const MAX_ICON_TRIES = 4;
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
  /** Pixel size of the stored icon, read from its own header (0 for SVG, which is vector). */
  icon_w: number | null;
  icon_h: number | null;
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
    icon_w: null,
    icon_h: null,
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
    // The site refused us (403 is common) or timed out. The listing still deserves its logo,
    // so fall back to the favicon service — the same thing other leaderboards show.
    const fallbackHost = safeHost(finalUrl);
    const { icon } = fallbackHost
      ? await downloadIcon(env, listingKey, [], iconService(fallbackHost))
      : { icon: null };
    return {
      ...base,
      status: icon ? "partial" : "failed",
      icon_key: icon?.key ?? null,
      icon_type: icon?.type ?? null,
      icon_bytes: icon?.bytes ?? null,
      icon_w: icon?.w ?? null,
      icon_h: icon?.h ?? null,
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
  const title =
    pick(["og:site_name", "application-name", "apple-mobile-web-app-title"]) ??
    clean(/<title[^>]*>([\s\S]{0,300})<\/title>/i.exec(head)?.[1], MAX_NAME) ??
    pick(["og:title", "twitter:title"]) ??
    host;
  const [name, tagline] = splitTitle(title);
  const description =
    pick(["og:description", "description", "twitter:description"]) ?? tagline;

  // ── icon: prefer a big apple-touch-icon, then the largest declared icon, then /favicon.ico
  // ── icon: collect every candidate, then download the best ones until one is big enough.
  const links = head.match(/<link\b[^>]*>/gi) ?? [];
  const candidates: { url: string; score: number }[] = [];
  const add = (href: string, score: number) => {
    try {
      const url = new URL(href, finalUrl).toString();
      if (!candidates.some((c) => c.url === url)) candidates.push({ url, score });
    } catch {}
  };

  let manifestHref: string | null = null;
  for (const tag of links) {
    const rel = (attr(tag, "rel") || "").toLowerCase();
    const href = attr(tag, "href");
    if (!href) continue;
    if (/(^|\s)manifest(\s|$)/.test(rel)) {
      manifestHref = href;
      continue;
    }
    if (!/icon/.test(rel) || /mask-icon/.test(rel)) continue;
    const declared = Math.max(
      0,
      ...(attr(tag, "sizes") || "")
        .split(/\s+/)
        .map((s) => parseInt(s, 10) || 0),
    );
    // An apple-touch-icon is 180px by convention even when it says nothing.
    add(href, declared || (/apple-touch/.test(rel) ? 180 : /\.svg($|\?)/i.test(href) ? 512 : 32));
  }

  // A web app manifest usually lists the 192 and 512px icons — the best source there is.
  if (manifestHref) {
    try {
      const url = new URL(manifestHref, finalUrl).toString();
      const res = await fetch(url, {
        headers: { "user-agent": UA, accept: "application/manifest+json,application/json" },
        redirect: "follow",
        signal: AbortSignal.timeout(MANIFEST_TIMEOUT_MS),
      });
      if (res.ok) {
        const text = new TextDecoder("utf-8", { fatal: false }).decode(
          await readCapped(res, MAX_MANIFEST_BYTES),
        );
        const icons = (JSON.parse(text)?.icons ?? []) as {
          src?: string;
          sizes?: string;
          purpose?: string;
        }[];
        for (const i of icons.slice(0, 12)) {
          if (!i?.src || /monochrome/.test(i.purpose || "")) continue;
          const declared = Math.max(
            0,
            ...String(i.sizes || "")
              .split(/\s+/)
              .map((x) => parseInt(x, 10) || 0),
          );
          add(new URL(i.src, url).toString(), declared || 192);
        }
      }
    } catch {
      // A missing or broken manifest is not an error: the <link> icons still stand.
    }
  }

  add("/apple-touch-icon.png", 180);
  add("/apple-touch-icon-precomposed.png", 180);
  add("/favicon.ico", 16);
  candidates.sort((a, b) => b.score - a.score);

  const { icon, error: iconError } = await downloadIcon(
    env,
    listingKey,
    candidates,
    host ? iconService(host) : null,
  );

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
    icon_w: icon?.w ?? null,
    icon_h: icon?.h ?? null,
    source_url: finalUrl,
    error: icon ? null : iconError,
    ms: Date.now() - started,
  };
}

/** Public favicon service: the fallback for sites that block us or ship no icon of their own. */
const iconService = (host: string) =>
  `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=256`;

type StoredIcon = { key: string; type: string; bytes: number; w: number; h: number };

/**
 * Download candidates best-first, stop as soon as one is big enough for the board, and store only
 * the winner. `service` is always tried when nothing else reached GOOD_ICON_PX — it is one request
 * to a CDN, and it is the difference between a logo and a letter tile for sites that block bots.
 */
async function downloadIcon(
  env: CloudflareEnv,
  listingKey: string,
  candidates: { url: string; score: number }[],
  service: string | null,
): Promise<{ icon: StoredIcon | null; error: string | null }> {
  type Found = { type: string; ext: string; bytes: Uint8Array; w: number; h: number; rank: number };
  let best: Found | null = null;
  // Tracked next to `best` so the loop below doesn't have to narrow a closure-assigned variable.
  let bestRank = -1;
  let error: string | null = null;
  let tries = 0;

  const attempt = async (url: string) => {
    tries++;
    try {
      const res = await fetch(url, {
        headers: { "user-agent": UA, accept: "image/*" },
        redirect: "follow",
        signal: AbortSignal.timeout(ICON_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const type = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      const ext = ICON_EXT[type];
      if (!ext) throw new Error(`type ${type || "unknown"}`);
      const bytes = await readCapped(res, MAX_ICON_BYTES);
      if (bytes.length < 60) throw new Error("too small");
      const size = imageSize(bytes, type);
      const rank = iconRank(size);
      if (rank > bestRank) {
        best = { type, ext, bytes, w: size?.w ?? 0, h: size?.h ?? 0, rank };
        bestRank = rank;
      }
    } catch (err) {
      error = msg(err);
    }
  };

  for (const c of candidates) {
    if (tries >= MAX_ICON_TRIES) break;
    if (bestRank >= GOOD_ICON_PX) break;
    await attempt(c.url);
  }
  if (service && bestRank < GOOD_ICON_PX) await attempt(service);

  if (!best) return { icon: null, error };
  const found: Found = best;
  const key = `brand-icons/${slug(listingKey)}.${found.ext}`;
  await env.CLIPS.put(key, found.bytes, {
    httpMetadata: { contentType: found.type, cacheControl: "public, max-age=604800" },
  });
  return {
    icon: { key, type: found.type, bytes: found.bytes.length, w: found.w, h: found.h },
    error: null,
  };
}

/**
 * Pixel size straight from the file header — no decoding, a few dozen byte reads.
 * SVG is vector, so it reports as "big enough" and wins any comparison it enters.
 */
export function imageSize(bytes: Uint8Array, type: string): { w: number; h: number } | null {
  if (type === "image/svg+xml") return { w: 0, h: 0 };
  const b = bytes;
  const be16 = (i: number) => (b[i] << 8) | b[i + 1];
  const le16 = (i: number) => b[i] | (b[i + 1] << 8);
  const be32 = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;

  // PNG
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
    return { w: be32(16), h: be32(20) };

  // GIF
  if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46)
    return { w: le16(6), h: le16(8) };

  // ICO / CUR: a directory of images; the largest one is what a browser would use.
  if (b.length > 6 && b[0] === 0 && b[1] === 0 && (b[2] === 1 || b[2] === 2)) {
    const n = le16(4);
    let w = 0,
      h = 0;
    for (let i = 0; i < n && 6 + i * 16 + 1 < b.length; i++) {
      const o = 6 + i * 16;
      const cw = b[o] || 256;
      const ch = b[o + 1] || 256;
      if (cw * ch > w * h) [w, h] = [cw, ch];
    }
    return w ? { w, h } : null;
  }

  // WebP
  if (b.length > 30 && b[0] === 0x52 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42) {
    const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (chunk === "VP8 ") return { w: le16(26) & 0x3fff, h: le16(28) & 0x3fff };
    if (chunk === "VP8L")
      return {
        w: 1 + (((b[22] & 0x3f) << 8) | b[21]),
        h: 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)),
      };
    if (chunk === "VP8X")
      return {
        w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)),
        h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)),
      };
    return null;
  }

  // JPEG: walk the segment markers to the frame header.
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
        return { w: be16(i + 7), h: be16(i + 5) };
      i += 2 + be16(i + 2);
    }
  }
  return null;
}

/** Bigger is better; SVG (0x0) is vector and outranks every raster size. */
const iconRank = (size: { w: number; h: number } | null) =>
  !size ? 0 : size.w === 0 ? 100_000 : Math.min(size.w, size.h);

/** Fetch + store. Safe to call repeatedly; the newest result replaces the old row. */
export async function enrichAndSave(
  env: CloudflareEnv,
  listingKey: string,
  link: string,
) {
  const r = await enrichListing(env, listingKey, link);
  await env.DB.prepare(
    `INSERT INTO listing_meta (listing_key, name, description, icon_key, icon_type, icon_bytes, icon_w, icon_h, source_url, status, error, attempts, fetched_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?11, ?12, ?7, ?8, ?9, 1, ?10)
     ON CONFLICT (listing_key) DO UPDATE SET
       name = ?2, description = ?3, icon_key = ?4, icon_type = ?5, icon_bytes = ?6, icon_w = ?11, icon_h = ?12,
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
      r.icon_w,
      r.icon_h,
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

// Page titles are mostly "Brand | what we do". The board shows the brand on one line and the
// rest under it, so a title that carries both is split rather than truncated mid-word.
const GENERIC = new Set(["home", "welcome", "index", "start", "official site", "homepage"]);

export function splitTitle(title: string | null): [string | null, string | null] {
  if (!title) return [title, null];
  const parts = title
    .split(/\s+[|\u2013\u2014\u00b7\u2022:]\s+|\s+-\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
  if (parts.length < 2) return [title, null];
  // The brand is the short side: "Selvo | Support without per-seat fees" and
  // "AI SEO Platform: traffic from AI search | RankControl" both name the product in a few characters.
  const first = parts[0];
  const last = parts[parts.length - 1];
  const firstGeneric = GENERIC.has(first.toLowerCase());
  const lastGeneric = GENERIC.has(last.toLowerCase());
  const brandFirst = firstGeneric ? false : lastGeneric ? true : first.length <= last.length;
  const brand = brandFirst ? first : last;
  if (brand.length < 2 || brand.length > 28) return [title, null];
  const rest = (brandFirst ? parts.slice(1) : parts.slice(0, -1))
    .filter((x) => !GENERIC.has(x.toLowerCase()))
    .join(" \u00b7 ");
  return [brand, rest.length > 3 ? rest.slice(0, MAX_DESC) : null];
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
