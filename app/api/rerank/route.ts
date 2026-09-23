import { cf, edgeCache } from "@/lib/edge";
import { rerank } from "@/lib/rank";
import { hasBearer } from "@/server/auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/rerank?trigger=upload — re-run the hourly ranking job now (called by platform/upload_r2.py
 * after an upload so a new clip isn't invisible until the next cron). Authorization: Bearer <RERANK_TOKEN>.
 */
export async function POST(request: Request) {
  const { env } = cf();
  if (!(await hasBearer(request, env.RERANK_TOKEN)))
    return Response.json({ error: "unauthorized" }, { status: 401 });

  const trigger = new URL(request.url).searchParams.get("trigger") === "upload" ? "upload" : "manual";
  const { feed, statsError, ms } = await rerank(env, trigger);
  await edgeCache()?.delete(new URL("/feed.json", request.url).toString());

  return Response.json(
    { ok: true, trigger, source: feed.source, count: feed.count, generated_at: feed.generated_at, ms, stats_error: statsError, top: feed.clips.slice(0, 5) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
