/**
 * Seed the LOCAL dev stores so the board and the in-feed Outbid slide have listings to show.
 *
 * Local only, by construction: every wrangler call below passes --local and --config wrangler.local.jsonc
 * (that config has no `remote: true` and no routes), so nothing here can read or write production.
 * The one network call is a public GET of the live feed.json, the same request any visitor makes.
 *
 *   node scripts-local-seed.mjs             seed everything
 *   node scripts-local-seed.mjs --feed-only rewrite feed.json only (the local cron overwrites it)
 *   node scripts-local-seed.mjs --reset     delete the seeded rows
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CONFIG = join(import.meta.dirname, "wrangler.local.jsonc");
// Pinned so the dev server and this script always read the same on-disk state, whatever the cwd.
const PERSIST = join(import.meta.dirname, ".wrangler", "state");
const tmp = mkdtempSync(join(tmpdir(), "outvids-seed-"));

function wrangler(args, label) {
  // --local is never optional here: it is what keeps this script off production.
  if (!args.includes("--local")) throw new Error("refusing to run without --local");
  const r = spawnSync(
    process.execPath,
    [join(import.meta.dirname, "node_modules/wrangler/bin/wrangler.js"), ...args,
     "--config", CONFIG, "--persist-to", PERSIST],
    { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" },
  );
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (r.status !== 0) {
    console.error(out);
    throw new Error(`${label} failed (exit ${r.status})`);
  }
  return out;
}

function sql(text, label) {
  const file = join(tmp, `${label}.sql`);
  writeFileSync(file, text, "utf8");
  return wrangler(["d1", "execute", "outvids", "--local", "--file", file], label);
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const DAY = 86_400_000;
const now = Date.now();

/**
 * Real sites, so the icon and text fetching is exercised against real HTML: the brands on
 * outbid.lol's board plus the five we tested first, and one dead domain for the fallback row.
 */
const LISTINGS = [
  { key: "see.io", link: "https://see.io", brand: "see.io", category: "AI", pays: [1700100], ago: [6] },
  { key: "tutti.so", link: "https://tutti.so", brand: "tutti.so", category: "Creator", pays: [1600000], ago: [5] },
  { key: "joni.ai", link: "https://joni.ai", brand: "joni.ai", category: "AI", pays: [1402800], ago: [5] },
  { key: "outrank.so", link: "https://outrank.so", brand: "outrank.so", category: "SaaS", pays: [1300500], ago: [4] },
  { key: "selvo.co", link: "https://selvo.co", brand: "selvo.co", category: "SaaS", pays: [15000, 9000], ago: [3, 0] },
  { key: "iroamly.com", link: "https://iroamly.com", brand: "iroamly.com", category: "Other", pays: [18000], ago: [2] },
  { key: "essaydone.ai", link: "https://essaydone.ai", brand: "essaydone.ai", category: "AI", pays: [9500], ago: [4] },
  { key: "orelon.ai", link: "https://orelon.ai", brand: "orelon.ai", category: "AI", pays: [6000], ago: [0] },
  { key: "cubicles.lol", link: "https://cubicles.lol", brand: "cubicles.lol", category: "Games", pays: [2500], ago: [0] },
  { key: "botseen.com", link: "https://botseen.com", brand: "botseen.com", category: "SaaS", pays: [1600], ago: [0] },
  { key: "gp-tree.com", link: "https://gp-tree.com", brand: "gp-tree.com", category: "AI", pays: [1100], ago: [0] },
  { key: "rctrl.com", link: "https://rctrl.com", brand: "rctrl.com", category: "SaaS", pays: [1000], ago: [0] },
  { key: "inetgeek.com", link: "https://inetgeek.com", brand: "inetgeek.com", category: "Hardware", pays: [1000], ago: [0] },
  { key: "nqz.ai", link: "https://nqz.ai", brand: "nqz.ai", category: "AI", pays: [1000], ago: [0] },
  {
    key: "etsy.com/shop/thejaipurheritage",
    link: "https://www.etsy.com/shop/THEJAIPURHERITAGE",
    brand: "etsy.com/shop/THEJAIPURHERITAGE",
    category: "Apparel",
    pays: [1000],
    ago: [0],
  },
  { key: "shopfront.invalid", link: "https://shopfront.invalid", brand: "shopfront.invalid", category: "Apparel", pays: [1000], ago: [0] },
];

const KEYS = LISTINGS.map((l) => q(l.key)).join(", ");

if (process.argv.includes("--reset")) {
  sql(
    `DELETE FROM bids WHERE listing_key IN (${KEYS});
     DELETE FROM listing_meta WHERE listing_key IN (${KEYS});`,
    "reset",
  );
  console.log("local seed rows deleted");
  process.exit(0);
}

const feedOnly = process.argv.includes("--feed-only");

/** Live feed.json, with clip urls made absolute so local playback streams from the public CDN
 *  instead of needing gigabytes of video copied into the local bucket. */
function seedFeed() {
  return fetch("https://outvids.lol/feed.json").then(async (res) => {
    if (!res.ok) throw new Error(`live feed.json returned ${res.status}`);
    const feed = await res.json();
    feed.clips = feed.clips.map((c) => ({
      ...c,
      url: c.url.startsWith("http") ? c.url : `https://outvids.lol${c.url}`,
      ...(c.poster && !c.poster.startsWith("http") ? { poster: `https://outvids.lol${c.poster}` } : {}),
    }));
    const file = join(tmp, "feed.json");
    writeFileSync(file, JSON.stringify(feed), "utf8");
    wrangler(
      ["r2", "object", "put", "clips/feed.json", "--local", "--file", file, "--content-type", "application/json"],
      "feed.json",
    );
    return feed.count;
  });
}

if (feedOnly) {
  console.log(`feed.json → local R2 (${await seedFeed()} clips)`);
  process.exit(0);
}

console.log("1/4  migrations → local D1");
wrangler(["d1", "migrations", "apply", "outvids", "--local"], "migrations");

console.log("2/4  listings → local D1");
const rows = [];
let n = 0;
// Both environments get the same listings, so flipping DODO_ENVIRONMENT in wrangler.local.jsonc
// shows either the labelled test-mode board or the live board that sponsors the feed.
for (const environment of ["test_mode", "live_mode"]) {
  for (const l of LISTINGS) {
    let prior = 0;
    l.pays.forEach((charge, i) => {
      const paidAt = now - l.ago[i] * DAY - (i + 1) * 3_600_000;
      const id = `bid_local${String(++n).padStart(4, "0")}`;
      rows.push(
        `(${q(id)}, ${q(`local-seed-${n}`)}, ${q(environment)}, ${q(l.key)}, ${q(l.link)}, ${q(l.brand)}, ${q(l.category)},` +
          ` ${prior}, ${prior + charge}, ${charge}, 'USD', 'paid', 'local seed', ${q(`pay_local${n}`)}, 'USD',` +
          ` ${Math.round(charge * 1.08)}, ${Math.round(charge * 0.08)}, ${paidAt}, ${paidAt}, ${paidAt})`,
      );
      prior += charge;
    });
  }
}
sql(
  `DELETE FROM bids WHERE listing_key IN (${KEYS});
   DELETE FROM listing_meta WHERE listing_key IN (${KEYS});
   INSERT INTO bids (id, idempotency_key, environment, listing_key, link, brand, category,
                     prior_cents, target_cents, charge_cents, currency, status, status_reason,
                     payment_id, paid_currency, paid_total, paid_tax, created_at, updated_at, paid_at)
   VALUES ${rows.join(",\n          ")};`,
  "listings",
);

console.log("3/4  feed.json → local R2");
const count = await seedFeed();

console.log("4/4  done");
console.log(`     ${LISTINGS.length} listings in both modes, ${rows.length} payments, ${count} clips`);
console.log("");
console.log("     Brand names, descriptions and icons are fetched by the Worker itself, from the");
console.log("     real sites, exactly as it does after a payment. Run the local cron once:");
console.log("       curl http://127.0.0.1:8787/cdn-cgi/handler/scheduled");
console.log("     That same cron also re-ranks, which overwrites feed.json, so afterwards run:");
console.log("       node scripts-local-seed.mjs --feed-only");
