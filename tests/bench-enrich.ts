/**
 * How much CPU brand enrichment actually burns.
 *
 * Workers bill CPU, not the time spent waiting on someone else's server, and the free plan kills an
 * invocation at 10ms of CPU. So this runs in two phases: first it fetches each site for real and keeps
 * every response in memory, then it replays those bytes with the network stubbed out and measures only
 * the parsing, the header sniffing and the R2 write.
 *
 * Run: npm run bench:enrich
 */
import { enrichListing } from "../server/enrich";

const SITES = [
  "https://see.io",
  "https://tutti.so",
  "https://joni.ai",
  "https://outrank.so",
  "https://selvo.co",
  "https://iroamly.com",
  "https://essaydone.ai",
  "https://orelon.ai",
  "https://cubicles.lol",
  "https://botseen.com",
  "https://gp-tree.com",
  "https://rctrl.com",
  "https://inetgeek.com",
  "https://nqz.ai",
  "https://www.etsy.com/shop/THEJAIPURHERITAGE",
];

const RUNS = 40; // process.cpuUsage() ticks in ~16ms steps on Windows, so measure many and divide

type Recorded = {
  status: number;
  headers: [string, string][];
  body: Uint8Array;
  url: string;
};
const tape = new Map<string, Recorded | "error">();
const realFetch = globalThis.fetch.bind(globalThis);

const env = {
  CLIPS: {
    async put(key: string, body: Uint8Array) {
      return { key, size: body.length };
    },
  },
} as unknown as CloudflareEnv;

const keyOf = (input: RequestInfo | URL) =>
  typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;

// ── phase 1: record (network time, not measured) ────────────────────────────
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = keyOf(input);
  try {
    const res = await realFetch(input as RequestInfo, init);
    const body = new Uint8Array(await res.clone().arrayBuffer());
    const headers = [...res.headers].filter(
      ([k]) => !/^content-(encoding|length)$/i.test(k),
    );
    tape.set(url, { status: res.status, headers, body, url: res.url || url });
    return res;
  } catch (err) {
    tape.set(url, "error");
    throw err;
  }
}) as typeof fetch;

process.stdout.write("recording");
for (const site of SITES) {
  await enrichListing(env, new URL(site).hostname.replace(/^www\./, ""), site);
  process.stdout.write(".");
}
process.stdout.write(`\n${tape.size} responses taped\n\n`);

// ── phase 2: replay from memory and measure CPU ─────────────────────────────
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const rec = tape.get(keyOf(input));
  if (!rec || rec === "error") throw new TypeError("recorded failure");
  return new Response(rec.body, { status: rec.status, headers: rec.headers });
}) as typeof fetch;

const results: { site: string; cpu: number[]; status: string; icon: string }[] =
  [];
for (const site of SITES) {
  const key = new URL(site).hostname.replace(/^www\./, "");
  let last;
  last = await enrichListing(env, key, site); // warm-up: JIT, not measured
  const before = process.cpuUsage();
  for (let i = 0; i < RUNS; i++) last = await enrichListing(env, key, site);
  const d = process.cpuUsage(before);
  const cpu = [(d.user + d.system) / 1000 / RUNS];
  results.push({
    site: key,
    cpu,
    status: last!.status,
    icon: last!.icon_w
      ? `${last!.icon_w}x${last!.icon_h}`
      : last!.icon_key
        ? "vector"
        : (last!.error ?? "-").slice(0, 20),
  });
}

const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
console.log(
  `${"site".padEnd(26)} ${"status".padEnd(8)} ${"icon".padEnd(22)} ${"cpu ms".padStart(8)}`,
);
let worst = 0;
for (const r of results) {
  const ms = r.cpu[0];
  worst = Math.max(worst, ms);
  console.log(
    `${r.site.padEnd(26)} ${r.status.padEnd(8)} ${r.icon.padEnd(22)} ${ms.toFixed(2).padStart(8)}`,
  );
}
console.log(
  `\nworst site: ${worst.toFixed(2)}ms of CPU per enrichment, against the 10ms limit.` +
    ` Mean ${avg(results.map((r) => r.cpu[0])).toFixed(2)}ms.`,
);
console.log(
  `Each number is ${RUNS} runs averaged after a warm-up run, with every response served from memory,`,
);
console.log(
  "so it is parsing, header sniffing and the R2 write only — no network wait, which Workers don't bill.",
);
