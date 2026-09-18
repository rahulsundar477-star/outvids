import { FEED_KEY } from "@/lib/clips";
import { cf, edgeCache } from "@/lib/edge";
import { rerank } from "@/lib/rank";

export const dynamic = "force-dynamic";

const CACHE_CONTROL = "public, max-age=60, s-maxage=300, stale-while-revalidate=600";

/**
 * GET /feed.json — the one ranked list. Hot path: edge cache → R2 object written by the re-rank job.
 * Only if the job has never run does this compute it (once) to bootstrap.
 */
export async function GET(request: Request) {
  const cache = edgeCache();
  const key = new Request(new URL("/feed.json", request.url).toString());

  if (cache) {
    const hit = await cache.match(new Request(key.url, { headers: request.headers }));
    if (hit) return hit;
  }

  const { env, ctx } = cf();
  let obj = await env.CLIPS.get(FEED_KEY);
  if (!obj) {
    await rerank(env, "bootstrap");
    obj = await env.CLIPS.get(FEED_KEY);
    if (!obj) return Response.json({ error: "feed_unavailable" }, { status: 503 });
  }

  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": CACHE_CONTROL,
    ETag: obj.httpEtag,
  });

  if (request.headers.get("if-none-match") === obj.httpEtag) return new Response(null, { status: 304, headers });

  const body = await obj.arrayBuffer();
  if (cache) ctx.waitUntil(cache.put(key, new Response(body, { headers })));
  return new Response(body, { headers });
}
