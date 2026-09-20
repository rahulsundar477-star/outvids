import { cf } from "@/lib/edge";
import { isValidClipId, isValidViewerId } from "@/lib/feed";
import { clientIp, edgeLimit } from "@/server/limit";

export const dynamic = "force-dynamic";

const REASONS = new Set(["swipe", "hidden", "tab", "unload"]);
const MAX_WATCH_MS = 10 * 60_000;

/**
 * POST /api/beacon — one per clip leave (navigator.sendBeacon, so the body is a text/plain JSON string).
 *   { c: clip_id, v: viewer_id, w: watched_ms, d: duration_ms, p: furthest_position_ms, l: loops, r: reason }
 *
 * Analytics Engine data point:
 *   index1 clip · blob1 clip · blob2 viewer · blob3 reason
 *   double1 watched_ms · double2 duration_ms · double3 completion ratio · double4 completed · double5 skipped · double6 loops
 */
export async function POST(request: Request) {
  // Ceilings first: a beacon is cheap, but nothing unauthenticated stays unbounded.
  const ip = clientIp(request);
  const rl = cf().env.BEACON_RL;
  const withinBinding = rl ? (await rl.limit({ key: ip })).success : true;
  if (!withinBinding || !(await edgeLimit("beacon", ip, 120, 60)))
    return new Response(null, { status: 429 });

  let b: Record<string, unknown>;
  try {
    b = JSON.parse(await request.text());
  } catch {
    return new Response(null, { status: 400 });
  }

  const clip = String(b.c ?? "");
  const viewer = String(b.v ?? "");
  const reason = REASONS.has(String(b.r)) ? String(b.r) : "swipe";
  const watched = clamp(Number(b.w), 0, MAX_WATCH_MS);
  const duration = clamp(Number(b.d), 0, MAX_WATCH_MS);
  const furthest = clamp(Number(b.p), 0, duration);
  const loops = clamp(Math.floor(Number(b.l)), 0, 1000);
  if (!isValidClipId(clip) || !isValidViewerId(viewer) || duration <= 0) return new Response(null, { status: 400 });

  const completed = loops > 0 || furthest >= 0.9 * duration ? 1 : 0;
  const ratio = completed ? 1 : furthest / duration;
  const skipped = !completed && watched < Math.min(2000, 0.25 * duration) ? 1 : 0;

  cf().env.BEACONS?.writeDataPoint({
    indexes: [clip],
    blobs: [clip, viewer, reason],
    doubles: [watched, duration, ratio, completed, skipped, loops],
  });

  return new Response(null, { status: 204 });
}

function clamp(n: number, lo: number, hi: number) {
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
}
