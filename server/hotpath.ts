/**
 * The swipe hot path as plain Worker code (no Next.js): /feed.json and /api/stream/:id.
 * Runs before the OpenNext handler loads, so each request costs a few ms of CPU instead of ~100ms —
 * that keeps the hot path inside the Workers CPU limit under load.
 * app/feed.json/route.ts and app/api/stream/[id]/route.ts stay for `next dev`, where worker.ts doesn't run.
 */
import { FEED_KEY, keyFromId } from "../lib/clips";
import { isValidClipId } from "../lib/feed";
import { rerank } from "../lib/rank";

const FEED_CACHE_CONTROL =
  "public, max-age=60, s-maxage=300, stale-while-revalidate=600";
const edgeCache = () => (caches as unknown as { default: Cache }).default;

export function isHotPath(pathname: string) {
  return (
    pathname === "/feed.json" ||
    pathname.startsWith("/api/stream/") ||
    pathname.startsWith("/api/icon/")
  );
}

export async function handleHotPath(
  request: Request,
  env: CloudflareEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("method not allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    });
  }
  if (url.pathname === "/feed.json") return feed(request, url, env, ctx);
  if (url.pathname.startsWith("/api/icon/")) return brandIcon(request, url, env, ctx);
  return stream(request, url, env, ctx);
}

// ── /feed.json: edge cache → R2 object written by the re-rank job ────────────

async function feed(
  request: Request,
  url: URL,
  env: CloudflareEnv,
  ctx: ExecutionContext,
) {
  const cache = edgeCache();
  const key = `${url.origin}/feed.json`;
  const hit = await cache.match(new Request(key, { headers: request.headers }));
  if (hit) return hit;

  let obj = await env.CLIPS.get(FEED_KEY);
  if (!obj) {
    // Only if the job has never run: compute once to bootstrap.
    await rerank(env, "bootstrap");
    obj = await env.CLIPS.get(FEED_KEY);
    if (!obj)
      return Response.json(
        { error: "feed_unavailable" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
  }

  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": FEED_CACHE_CONTROL,
    ETag: obj.httpEtag,
  });
  if (request.headers.get("if-none-match") === obj.httpEtag)
    return new Response(null, { status: 304, headers });

  const res = new Response(request.method === "HEAD" ? null : obj.body, {
    headers,
  });
  if (request.method === "GET") ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

// ── /api/stream/:id: edge cache (answers Range from the cached object) → R2 ──

async function stream(
  request: Request,
  url: URL,
  env: CloudflareEnv,
  ctx: ExecutionContext,
) {
  const id = decodeURIComponent(url.pathname.slice("/api/stream/".length));
  if (!isValidClipId(id)) return new Response("bad id", { status: 400 });
  const key = keyFromId(id);

  if (request.method === "HEAD") {
    const head = await env.CLIPS.head(key);
    if (!head) return new Response(null, { status: 404 });
    const headers = videoHeaders(head);
    headers.set("Content-Length", String(head.size));
    return new Response(null, { headers });
  }

  const cache = edgeCache();
  const cacheKey = `${url.origin}/api/stream/${id}`;
  const hit = await cache.match(
    new Request(cacheKey, { headers: request.headers }),
  );
  if (hit) return hit;

  const obj = await env.CLIPS.get(key, {
    range: request.headers,
    onlyIf: request.headers,
  });
  if (!obj) return new Response("not found", { status: 404 });
  const headers = videoHeaders(obj);
  if (!("body" in obj)) return new Response(null, { status: 304, headers });

  // Warm the edge cache with the whole object once, from the request that starts at byte 0.
  const range = request.headers.get("range");
  if (!range || /^bytes=0-/.test(range)) {
    ctx.waitUntil(
      env.CLIPS.get(key).then((full) => {
        if (!full) return;
        const h = videoHeaders(full);
        h.set("Content-Length", String(full.size));
        return cache.put(cacheKey, new Response(full.body, { headers: h }));
      }),
    );
  }

  const r = obj.range as
    { offset?: number; length?: number; suffix?: number } | undefined;
  if (r && range) {
    const offset =
      r.suffix !== undefined ? obj.size - r.suffix : (r.offset ?? 0);
    const length =
      r.suffix !== undefined ? r.suffix : (r.length ?? obj.size - offset);
    headers.set(
      "Content-Range",
      `bytes ${offset}-${offset + length - 1}/${obj.size}`,
    );
    headers.set("Content-Length", String(length));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set("Content-Length", String(obj.size));
  return new Response(obj.body, { headers });
}

function videoHeaders(obj: R2Object) {
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("ETag", obj.httpEtag);
  headers.set("Accept-Ranges", "bytes");
  if (!headers.has("Content-Type")) headers.set("Content-Type", "video/mp4");
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  return headers;
}

// ── /api/icon/:listing_key: brand icon stored by server/enrich.ts ────────────

async function brandIcon(request: Request, url: URL, env: CloudflareEnv, ctx: ExecutionContext) {
  const key = decodeURIComponent(url.pathname.slice("/api/icon/".length)).slice(0, 260);
  if (!key || key.includes("..")) return new Response("bad key", { status: 400 });

  const cache = edgeCache();
  const cacheKey = `${url.origin}/api/icon/${encodeURIComponent(key)}?v=${url.searchParams.get("v") ?? "0"}`;
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const row = await env.DB.prepare("SELECT icon_key FROM listing_meta WHERE listing_key = ?")
    .bind(key)
    .first<{ icon_key: string | null }>();
  if (!row?.icon_key) return new Response(null, { status: 404 });
  const obj = await env.CLIPS.get(row.icon_key);
  if (!obj) return new Response(null, { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("ETag", obj.httpEtag);
  headers.set("Cache-Control", "public, max-age=86400");
  headers.set("X-Content-Type-Options", "nosniff");
  if (!headers.has("Content-Type")) headers.set("Content-Type", "image/png");
  const res = new Response(obj.body, { headers });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}
