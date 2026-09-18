import { keyFromId } from "@/lib/clips";
import { cf, edgeCache } from "@/lib/edge";
import { isValidClipId } from "@/lib/feed";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET|HEAD /api/stream/:id — mp4 bytes. Edge cache first (it answers Range requests from the cached
 * full object), R2 on a miss, and the miss warms the cache in the background.
 */
export async function GET(request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!isValidClipId(id)) return new Response("bad id", { status: 400 });

  const cache = edgeCache();
  const cacheKey = new URL(`/api/stream/${id}`, request.url).toString();

  if (cache) {
    const hit = await cache.match(new Request(cacheKey, { headers: request.headers }));
    if (hit) return hit;
  }

  const { env, ctx } = cf();
  const key = keyFromId(id);
  const obj = await env.CLIPS.get(key, { range: request.headers, onlyIf: request.headers });
  if (!obj) return new Response("not found", { status: 404 });

  const headers = baseHeaders(obj);
  if (!("body" in obj)) return new Response(null, { status: 304, headers });

  // Warm the edge cache with the whole object once, from the request that starts at byte 0.
  const range = request.headers.get("range");
  if (cache && (!range || /^bytes=0-/.test(range))) {
    ctx.waitUntil(
      env.CLIPS.get(key).then((full) => {
        if (!full) return;
        const h = baseHeaders(full);
        h.set("Content-Length", String(full.size));
        return cache.put(cacheKey, new Response(full.body, { headers: h }));
      }),
    );
  }

  const r = obj.range as { offset?: number; length?: number; suffix?: number } | undefined;
  if (r && range) {
    const offset = r.suffix !== undefined ? obj.size - r.suffix : (r.offset ?? 0);
    const length = r.suffix !== undefined ? r.suffix : (r.length ?? obj.size - offset);
    headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    headers.set("Content-Length", String(length));
    return new Response(obj.body, { status: 206, headers });
  }

  headers.set("Content-Length", String(obj.size));
  return new Response(obj.body, { headers });
}

export async function HEAD(_request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!isValidClipId(id)) return new Response(null, { status: 400 });
  const head = await cf().env.CLIPS.head(keyFromId(id));
  if (!head) return new Response(null, { status: 404 });
  const headers = baseHeaders(head);
  headers.set("Content-Length", String(head.size));
  return new Response(null, { headers });
}

function baseHeaders(obj: R2Object) {
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("ETag", obj.httpEtag);
  headers.set("Accept-Ranges", "bytes");
  if (!headers.has("Content-Type")) headers.set("Content-Type", "video/mp4");
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  return headers;
}
