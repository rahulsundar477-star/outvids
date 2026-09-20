import { idFromKey, loadManifest } from "@/lib/clips";
import { cf } from "@/lib/edge";
import { isValidClipId, isValidViewerId } from "@/lib/feed";
import { clientIp, edgeLimit } from "@/server/limit";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

/**
 * POST /api/vote  { clip_id, viewer_id, on }  → { clip_id, on, votes }
 * One Outvid per viewer per clip (primary key). `votes` is the real unique count after the write.
 */
export async function POST(request: Request) {
  let body: { clip_id?: unknown; viewer_id?: unknown; on?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad_json" }, { status: 400, headers: noStore });
  }
  const clipId = String(body.clip_id ?? "");
  const viewerId = String(body.viewer_id ?? "");
  const on = body.on !== false;
  if (!isValidClipId(clipId) || !isValidViewerId(viewerId)) {
    return Response.json({ error: "bad_request" }, { status: 400, headers: noStore });
  }

  const { env } = cf();
  // Ceilings before any D1 write, so one script can't run up our metered usage.
  const ip = clientIp(request);
  const withinBinding = env.VOTE_RL ? (await env.VOTE_RL.limit({ key: ip })).success : true;
  const success = withinBinding && (await edgeLimit("vote", ip, 60, 60));
  if (!success)
    return Response.json(
      { error: "rate_limited" },
      { status: 429, headers: { ...noStore, "Retry-After": "60" } },
    );

  const rows = await loadManifest(env.CLIPS);
  if (!rows.some((r) => idFromKey(r.r2_key) === clipId)) {
    return Response.json({ error: "unknown_clip" }, { status: 404, headers: noStore });
  }

  const write = on
    ? env.DB.prepare("INSERT OR IGNORE INTO votes (clip_id, voter_id, created_at) VALUES (?, ?, ?)").bind(clipId, viewerId, Date.now())
    : env.DB.prepare("DELETE FROM votes WHERE clip_id = ? AND voter_id = ?").bind(clipId, viewerId);
  const count = env.DB.prepare("SELECT COUNT(*) AS n FROM votes WHERE clip_id = ?").bind(clipId);
  const [, counted] = await env.DB.batch<{ n: number }>([write, count]);

  return Response.json({ clip_id: clipId, on, votes: Number(counted.results[0]?.n ?? 0) }, { headers: noStore });
}
