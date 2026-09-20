/**
 * A per-IP ceiling that actually trips.
 *
 * Cloudflare's rate limiting binding is documented as "permissive, eventually consistent, and
 * intentionally designed to not be used as an accurate accounting system". Measured against
 * production, it let 40 sequential requests through a 10-per-minute limit, so it can't be the
 * thing standing between us and a bill.
 *
 * This counts in two places, cheapest first:
 *   1. in the isolate's own memory — exact, instant, free, and most of one attacker's requests
 *      land on the same few isolates;
 *   2. in the edge cache — shared by the isolates in that colo, so a spread-out burst still adds up.
 *
 * Neither is a hard global cap (Cloudflare gives no such thing below the WAF), and cache writes
 * take a moment to become visible, so a fast burst can slip a few extra through. Its job is to stop
 * sustained abuse from turning into metered usage, and it does that without touching D1 or R2.
 *
 * The hard edge is a WAF rate limiting rule in front of /api/* — see docs/runbook.md.
 */
const NS = "https://ratelimit.outvids.internal";

/** slot → key → count, for this isolate. Cleared whenever the window rolls, so it can't grow. */
let localSlot = -1;
let local = new Map<string, number>();

export async function edgeLimit(
  bucket: string,
  key: string,
  limit: number,
  windowSec = 60,
): Promise<boolean> {
  const slot = Math.floor(Date.now() / (windowSec * 1000));
  if (slot !== localSlot) {
    localSlot = slot;
    local = new Map();
  }
  const id = `${bucket}:${key}`;
  const seen = (local.get(id) ?? 0) + 1;
  local.set(id, seen);
  if (seen > limit) return false;

  const cache = (caches as unknown as { default?: Cache }).default;
  if (!cache) return true; // no edge cache (local dev): the in-memory count still applies
  const url = `${NS}/${bucket}/${slot}/${encodeURIComponent(key).slice(0, 120)}`;
  try {
    const hit = await cache.match(url);
    const shared = hit ? Number(await hit.text()) || 0 : 0;
    if (shared >= limit) {
      local.set(id, limit + 1); // remember it locally so the next one skips the lookup
      return false;
    }
    await cache.put(
      url,
      new Response(String(Math.max(shared + 1, seen)), {
        headers: {
          "Cache-Control": `max-age=${windowSec}`,
          "Content-Type": "text/plain",
        },
      }),
    );
    return true;
  } catch {
    return true; // a broken counter must never take the app down
  }
}

/** Tests run many scenarios in one process from one address: this gives each a clean slate. */
export function resetEdgeLimit() {
  localSlot = -1;
  local = new Map();
}

/** The caller's address, or a stable stand-in when Cloudflare didn't give us one. */
export const clientIp = (request: Request) =>
  request.headers.get("cf-connecting-ip") ||
  request.headers.get("x-real-ip") ||
  "unknown";
