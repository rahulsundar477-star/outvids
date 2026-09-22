/**
 * Feed ordering rules: the held-back gate, the promo slots, and shuffle stability.
 * Run: npm run test:feed
 */
import { HOLD_UNTIL, orderFeed } from "../lib/shuffle";

// Hard-coded on purpose: the product rule is "not in the first 100", so the test must not
// read the constant it is checking (a change to HOLD_UNTIL has to fail here).
const FIRST = 100;
import { promoSlots } from "../lib/promo";
import { isHeldBack, posterIds } from "../lib/rank";
import type { FeedClip } from "../lib/feed";

const results: { name: string; ok: boolean; err?: string }[] = [];
function eq(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
}
function test(name: string, fn: () => void) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (e) {
    results.push({ name, ok: false, err: (e as Error).message });
  }
}

const clip = (
  i: number,
  hold: 0 | 1 = 0,
  over: Partial<FeedClip> = {},
): FeedClip => ({
  id: `clip${String(i).padStart(3, "0")}`,
  url: `/api/stream/clip${i}`,
  track: ["main", "rc", "pod", "balanced"][i % 4],
  setting: ["work", "public", "home", "stage", "outdoor"][i % 5],
  people: "solo",
  frame: "medium",
  engine: null,
  duration: 7,
  votes: 0,
  views: 0,
  score: 0.5 + (i % 10) / 100,
  weight: 1,
  hold,
  ...over,
});

// 256 clips, 7 held — the shape of the real catalog
const catalog = [...Array(256)].map((_, i) =>
  clip(i, i % 37 === 3 && i < 260 ? 1 : 0),
);
const heldIds = new Set(catalog.filter((c) => c.hold === 1).map((c) => c.id));

test("held clips never appear in the first 100, for any viewer", () => {
  eq(HOLD_UNTIL, FIRST, "HOLD_UNTIL is still the agreed 100");
  eq(heldIds.size > 0, true, "fixture has held clips");
  for (let v = 0; v < 200; v++) {
    const order = orderFeed(catalog, `viewer${v}-2026-09-18`, {});
    const early = order.slice(0, FIRST).filter((c) => heldIds.has(c.id));
    if (early.length)
      throw new Error(
        `viewer${v}: ${early.map((c) => c.id)} inside first ${FIRST}`,
      );
  }
});

test("held clips still play later, and nothing is lost or duplicated", () => {
  const order = orderFeed(catalog, "viewer-x-2026-09-18", {});
  eq(order.length, catalog.length, "same length");
  eq(new Set(order.map((c) => c.id)).size, catalog.length, "no duplicates");
  const heldPositions = order
    .map((c, i) => [c, i] as const)
    .filter(([c]) => heldIds.has(c.id))
    .map(([, i]) => i);
  eq(heldPositions.length, heldIds.size, "all held clips present");
  eq(
    Math.min(...heldPositions) >= HOLD_UNTIL,
    true,
    `earliest held at ${Math.min(...heldPositions)}`,
  );
  // spread out, not dumped in one block
  const gaps = heldPositions.slice(1).map((p, i) => p - heldPositions[i]);
  eq(
    gaps.every((g) => g > 1),
    true,
    `held clips adjacent: gaps ${gaps}`,
  );
});

test("a shared link still opens on a held clip", () => {
  const held = [...heldIds][0];
  const order = orderFeed(catalog, "viewer-y-2026-09-18", {}, held);
  eq(order[0].id, held, "pinned first");
});

test("watched clips move back but the gate still holds", () => {
  const seen: Record<string, number> = {};
  catalog.slice(0, 120).forEach((c, i) => (seen[c.id] = Date.now() - i * 1000));
  const order = orderFeed(catalog, "viewer-z-2026-09-18", seen);
  eq(order.length, catalog.length, "length");
  const early = order.slice(0, FIRST).filter((c) => heldIds.has(c.id));
  eq(early.length, 0, "no held clips early");
});

test("same seed gives the same order, a different seed doesn't", () => {
  const a = orderFeed(catalog, "same-seed", {}).map((c) => c.id);
  const b = orderFeed(catalog, "same-seed", {}).map((c) => c.id);
  const c = orderFeed(catalog, "other-seed", {}).map((c) => c.id);
  eq(a, b, "stable for one seed");
  eq(a.join() !== c.join(), true, "differs across seeds");
});

test("a catalog smaller than the gate puts held clips last", () => {
  const small = [...Array(12)].map((_, i) => clip(i, i < 3 ? 1 : 0));
  const order = orderFeed(small, "small", {});
  eq(
    order.slice(0, 9).every((c) => c.hold !== 1),
    true,
    "free clips first",
  );
  eq(
    order.slice(9).every((c) => c.hold === 1),
    true,
    "held clips last",
  );
});

test("the hold rule matches older-cast interview formats only", () => {
  const row = (over: Record<string, unknown>) =>
    ({
      track: "rc",
      tag_age: "older",
      tag_speech: "exchange",
      ...over,
    }) as never;
  eq(isHeldBack(row({})), true, "rc older exchange");
  eq(
    isHeldBack(row({ track: "pod", tag_speech: "single" })),
    true,
    "pod older single",
  );
  eq(isHeldBack(row({ tag_age: "young" })), false, "young cast");
  eq(isHeldBack(row({ tag_speech: "silent" })), false, "silent");
  eq(isHeldBack(row({ track: "main" })), false, "main track");
});

test("promo slides start after 3-4 reels and repeat 6-12 apart", () => {
  for (let v = 0; v < 100; v++) {
    const slots = [...promoSlots(`viewer${v}-2026-09-18`, 256)].sort(
      (a, b) => a - b,
    );
    if (slots[0] < 3 || slots[0] > 4)
      throw new Error(`first promo at ${slots[0]}`);
    const gaps = slots.slice(1).map((s, i) => s - slots[i]);
    if (gaps.some((g) => g < 6 || g > 12))
      throw new Error(`gap out of range: ${gaps}`);
  }
});

// Async rules run after the sync ones and report into the same list.
const bucketWith = (value: unknown) =>
  ({
    get: async (key: string) =>
      key === "posters/index.json" && value !== undefined
        ? { json: async () => (typeof value === "string" ? JSON.parse(value) : value) }
        : null,
  }) as unknown as R2Bucket;
try {
  eq([...(await posterIds(bucketWith(["a", "b", 3, null])))], ["a", "b"], "only string ids");
  eq((await posterIds(bucketWith(undefined))).size, 0, "no index yet");
  eq((await posterIds(bucketWith("{not json"))).size, 0, "broken index");
  eq((await posterIds(bucketWith({ ids: ["a"] }))).size, 0, "wrong shape");
  results.push({ name: "a missing or broken poster index means no posters, never a failed re-rank", ok: true });
} catch (e) {
  results.push({
    name: "a missing or broken poster index means no posters, never a failed re-rank",
    ok: false,
    err: (e as Error).message,
  });
}

for (const r of results)
  console.log(
    `${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.err ? `\n      ${r.err}` : ""}`,
  );
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed) process.exit(1);
