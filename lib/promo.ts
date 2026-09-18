/**
 * Where the Outbid slide appears in the feed.
 * First one after 3–4 reels, then a random 6–12 reels apart — seeded by viewer + day, so the
 * positions are stable while you scroll (no reshuffling on re-render) but differ per person and day.
 */

const FIRST_MIN = 3;
const FIRST_SPREAD = 2; // 3 or 4
const GAP_MIN = 6;
const GAP_SPREAD = 7; // 6…12

function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++)
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Clip counts after which a promo slide is inserted, e.g. {4, 13, 21} → promo after the 4th, 13th, 21st reel. */
export function promoSlots(seed: string, clipCount: number): Set<number> {
  const rand = rng(`promo-${seed}`);
  const slots = new Set<number>();
  let at = FIRST_MIN + Math.floor(rand() * FIRST_SPREAD);
  while (at < clipCount) {
    slots.add(at);
    at += GAP_MIN + Math.floor(rand() * GAP_SPREAD);
  }
  return slots;
}
