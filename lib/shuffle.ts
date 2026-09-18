/**
 * Client shuffle over the ranked feed.json: seeded weighted order (same viewer + day → same order, so a
 * refresh doesn't reshuffle), clips already watched in the last day go to the back, and no two clips with
 * the same setting or engine play back-to-back when anything else can go there.
 */
import type { FeedClip } from "./feed";

function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Weighted random order without replacement (exponential race: smaller key goes first). */
function weightedOrder(clips: FeedClip[], rand: () => number) {
  return clips
    .map((c) => ({ c, k: -Math.log(1 - rand()) / Math.max(c.weight, 1e-6) }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.c);
}

const LOOKAHEAD = 8;

function spreadOut(list: FeedClip[]) {
  const pool = list.slice();
  const out: FeedClip[] = [];
  while (pool.length) {
    const prev = out[out.length - 1];
    let pick = 0;
    if (prev) {
      const i = pool.slice(0, LOOKAHEAD).findIndex((c) => c.setting !== prev.setting && (c.engine === null || c.engine !== prev.engine));
      if (i > 0) pick = i;
    }
    out.push(pool.splice(pick, 1)[0]);
  }
  return out;
}

/** Held-back formats stay out of everyone's first this-many reels. */
export const HOLD_UNTIL = 100;
const HELD_EVERY = 15; // after the gate, sprinkle one held clip per this many normal ones

/**
 * Put held clips (feed.json `hold: 1`) after the first HOLD_UNTIL positions, then spread them
 * thinly. If there aren't HOLD_UNTIL free clips, every held clip simply goes last.
 */
function gateHeld(free: FeedClip[], held: FeedClip[]) {
  if (!held.length) return free;
  const out = free.slice(0, HOLD_UNTIL);
  const rest = free.slice(HOLD_UNTIL);
  let h = 0;
  rest.forEach((clip, i) => {
    out.push(clip);
    if ((i + 1) % HELD_EVERY === 0 && h < held.length) out.push(held[h++]);
  });
  while (h < held.length) out.push(held[h++]);
  return out;
}

export function orderFeed(clips: FeedClip[], seed: string, seen: Record<string, number>, pinned?: string | null) {
  const rand = rng(seed);
  const ordered = weightedOrder(clips, rand);
  const fresh = ordered.filter((c) => !seen[c.id]);
  const watched = ordered.filter((c) => seen[c.id]).sort((a, b) => seen[a.id] - seen[b.id]);
  const ranked = spreadOut(fresh).concat(spreadOut(watched));
  const result = gateHeld(
    ranked.filter((c) => c.hold !== 1),
    ranked.filter((c) => c.hold === 1),
  );

  // A shared link (?clip=<id>) opens on that clip — even a held one, since it was asked for.
  if (pinned) {
    const i = result.findIndex((c) => c.id === pinned);
    if (i > 0) result.unshift(...result.splice(i, 1));
  }
  return result;
}
