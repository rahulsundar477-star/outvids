/**
 * What outvids.lol is actually using, against the free allowances — the number to look at before
 * a bill exists. Cloudflare has no hard spend limit, so this is the early warning.
 *
 *   npm run usage            last 24h and month to date
 *   npm run usage -- --days 7
 *
 * Needs a read-only API token in CF_ANALYTICS_TOKEN (or CLOUDFLARE_API_TOKEN):
 *   dash.cloudflare.com → My Profile → API Tokens → Create Token → Custom token
 *   Permissions: Account · Account Analytics · Read   and   Account · Workers Scripts · Read
 * Nothing is written by this script; the token only reads counters.
 */
const ACCOUNT = "3805ce8c26cbe0f2d05d0c2559973d27"; // same value as the OUTVIDS_ACCOUNT_ID var
const SCRIPT = "outvids";
const BUCKET = "clips";
const DATABASE = "84e14d12-c064-4ace-b5d2-9f095671a552";
const API = "https://api.cloudflare.com/client/v4/graphql";

// Free allowances, and the rates that apply past them. Cloudflare changes these: re-check at
// developers.cloudflare.com/workers/platform/pricing and /r2/pricing.
const FREE = {
  workerRequestsPerDay: 100_000,
  d1RowsReadPerDay: 5_000_000,
  d1RowsWrittenPerDay: 100_000,
  r2StorageGb: 10,
  r2ClassAPerMonth: 1_000_000,
  r2ClassBPerMonth: 10_000_000,
};
const RATE = {
  r2StorageGbMonth: 0.015,
  r2ClassAPerMillion: 4.5,
  r2ClassBPerMillion: 0.36,
};

const token =
  process.env.CF_ANALYTICS_TOKEN || process.env.CLOUDFLARE_API_TOKEN;
const days = Number(process.argv[process.argv.indexOf("--days") + 1]) || 1;

if (!token) {
  console.log(`No CF_ANALYTICS_TOKEN set, so this can only tell you where to look.

In the dashboard, the three numbers that matter:
  Workers & Pages → outvids → Metrics      requests/day vs ${FREE.workerRequestsPerDay.toLocaleString()} on the free plan
  R2 → clips → Metrics                     storage vs ${FREE.r2StorageGb} GB, Class A vs ${(FREE.r2ClassAPerMonth / 1e6).toFixed(0)}M, Class B vs ${(FREE.r2ClassBPerMonth / 1e6).toFixed(0)}M per month
  D1 → outvids → Metrics                   rows read vs ${(FREE.d1RowsReadPerDay / 1e6).toFixed(0)}M/day, rows written vs ${FREE.d1RowsWrittenPerDay.toLocaleString()}/day

Then set the alert (this is the guardrail, Cloudflare has no spend cap):
  Manage Account → Notifications → Add → Billing usage alert

To run this script instead, create a read-only token (My Profile → API Tokens → Custom token,
Account Analytics: Read) and set CF_ANALYTICS_TOKEN.`);
  process.exit(0);
}

const since = new Date(Date.now() - days * 86_400_000).toISOString();
const monthStart = new Date(
  new Date().getUTCFullYear(),
  new Date().getUTCMonth(),
  1,
)
  .toISOString()
  .slice(0, 10);

async function gql(query, variables) {
  const res = await fetch(API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors?.length)
    throw new Error(
      json.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`,
    );
  return json.data?.viewer?.accounts?.[0] ?? {};
}

const safe = async (label, fn) => {
  try {
    return await fn();
  } catch (err) {
    console.log(
      `  ${label}: unavailable (${String(err.message).slice(0, 90)})`,
    );
    return null;
  }
};

const pct = (used, limit) => `${((used / limit) * 100).toFixed(1)}% of free`;
const bar = (used, limit) => {
  const n = Math.min(20, Math.round((used / limit) * 20));
  return `[${"#".repeat(n)}${".".repeat(20 - n)}]`;
};
const line = (label, used, limit, unit = "") =>
  console.log(
    `  ${label.padEnd(22)} ${bar(used, limit)} ${used.toLocaleString()}${unit} / ${limit.toLocaleString()}${unit}  ${pct(used, limit)}`,
  );

console.log(
  `outvids usage — last ${days} day(s), month to date from ${monthStart}\n`,
);

// ── Workers ────────────────────────────────────────────────────────────────
const workers = await safe("workers", () =>
  gql(
    `query ($account: String!, $since: Time!, $script: String!) {
      viewer { accounts(filter: { accountTag: $account }) {
        workersInvocationsAdaptive(limit: 10000, filter: { datetime_geq: $since, scriptName: $script }) {
          sum { requests errors subrequests }
          quantiles { cpuTimeP50 cpuTimeP99 }
        } } } }`,
    { account: ACCOUNT, since, script: SCRIPT },
  ),
);
if (workers?.workersInvocationsAdaptive) {
  const rows = workers.workersInvocationsAdaptive;
  const requests = rows.reduce((n, r) => n + (r.sum?.requests ?? 0), 0);
  const errors = rows.reduce((n, r) => n + (r.sum?.errors ?? 0), 0);
  const p99 = Math.max(0, ...rows.map((r) => r.quantiles?.cpuTimeP99 ?? 0));
  console.log("Workers");
  line("requests/day", Math.round(requests / days), FREE.workerRequestsPerDay);
  console.log(`  ${"errors".padEnd(22)} ${errors.toLocaleString()}`);
  console.log(
    `  ${"CPU p99".padEnd(22)} ${(p99 / 1000).toFixed(1)}ms of the 10ms limit`,
  );
  console.log("");
}

// ── D1 ─────────────────────────────────────────────────────────────────────
const d1 = await safe("d1", () =>
  gql(
    `query ($account: String!, $date: Date!, $db: String!) {
      viewer { accounts(filter: { accountTag: $account }) {
        d1AnalyticsAdaptiveGroups(limit: 10000, filter: { date_geq: $date, databaseId: $db }) {
          sum { readQueries writeQueries rowsRead rowsWritten }
        } } } }`,
    { account: ACCOUNT, date: monthStart, db: DATABASE },
  ),
);
if (d1?.d1AnalyticsAdaptiveGroups) {
  const rows = d1.d1AnalyticsAdaptiveGroups;
  const read = rows.reduce((n, r) => n + (r.sum?.rowsRead ?? 0), 0);
  const written = rows.reduce((n, r) => n + (r.sum?.rowsWritten ?? 0), 0);
  const perDay = Math.max(1, new Date().getUTCDate());
  console.log("D1 (month to date, shown as a daily average)");
  line("rows read/day", Math.round(read / perDay), FREE.d1RowsReadPerDay);
  line(
    "rows written/day",
    Math.round(written / perDay),
    FREE.d1RowsWrittenPerDay,
  );
  console.log("");
}

// ── R2: the only thing here that can actually bill ─────────────────────────
const r2 = await safe("r2", () =>
  gql(
    `query ($account: String!, $date: Date!, $bucket: String!) {
      viewer { accounts(filter: { accountTag: $account }) {
        r2StorageAdaptiveGroups(limit: 100, filter: { date_geq: $date, bucketName: $bucket }) {
          max { payloadSize objectCount }
        }
        r2OperationsAdaptiveGroups(limit: 1000, filter: { date_geq: $date, bucketName: $bucket }) {
          dimensions { actionType } sum { requests }
        } } } }`,
    { account: ACCOUNT, date: monthStart, bucket: BUCKET },
  ),
);
let overage = 0;
if (r2?.r2StorageAdaptiveGroups) {
  const gb =
    Math.max(
      0,
      ...r2.r2StorageAdaptiveGroups.map((r) => r.max?.payloadSize ?? 0),
    ) / 1e9;
  // Class A writes/lists, Class B reads. Anything not a read is charged at the higher rate.
  const ops = r2.r2OperationsAdaptiveGroups ?? [];
  const isClassB = (a) => /^(Get|Head|UsageSummary|ListParts)/i.test(String(a));
  const classB = ops
    .filter((o) => isClassB(o.dimensions?.actionType))
    .reduce((n, o) => n + (o.sum?.requests ?? 0), 0);
  const classA = ops
    .filter((o) => !isClassB(o.dimensions?.actionType))
    .reduce((n, o) => n + (o.sum?.requests ?? 0), 0);

  console.log("R2 (month to date) — the only metered service here");
  line("storage", Number(gb.toFixed(2)), FREE.r2StorageGb, " GB");
  line("class A (writes)", classA, FREE.r2ClassAPerMonth);
  line("class B (reads)", classB, FREE.r2ClassBPerMonth);

  overage =
    Math.max(0, gb - FREE.r2StorageGb) * RATE.r2StorageGbMonth +
    (Math.max(0, classA - FREE.r2ClassAPerMonth) / 1e6) *
      RATE.r2ClassAPerMillion +
    (Math.max(0, classB - FREE.r2ClassBPerMonth) / 1e6) *
      RATE.r2ClassBPerMillion;
  console.log("");
}

console.log(
  overage > 0
    ? `Estimated R2 charges this month: about $${overage.toFixed(2)}. Rates change — confirm in the dashboard.`
    : "Everything is inside the free allowances. Estimated charges: $0.",
);
console.log(
  "If that changes fast, `npm run panic` takes the app off R2 and D1 in about 20 seconds.",
);
