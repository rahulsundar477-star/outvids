/**
 * Go-live helper for Outbid payments.
 *
 *   node scripts-golive.mjs check        what's configured, and what test data exists
 *   node scripts-golive.mjs clean-test   dry run: what would be removed
 *   node scripts-golive.mjs clean-test --yes   back up test data to backups/, then delete it
 *
 * Only ever touches rows with environment = 'test_mode'. It refuses to run if a live-mode row
 * would match, and it always writes a JSON backup before deleting.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";

const WRANGLER = path.join("node_modules", "wrangler", "bin", "wrangler.js");
const DB = "outvids";
const TEST = "test_mode";

function sql(query) {
  const r = spawnSync(
    process.execPath,
    [WRANGLER, "d1", "execute", DB, "--remote", "--json", "--command", query],
    { encoding: "utf8" },
  );
  const out = r.stdout || "";
  const start = out.indexOf("[");
  if (start < 0)
    throw new Error(`d1 failed: ${(r.stderr || out).slice(0, 300)}`);
  const parsed = JSON.parse(out.slice(start));
  return parsed.flatMap((p) => p.results ?? []);
}

const config = () => {
  const raw = readFileSync("wrangler.jsonc", "utf8")
    .replace(/^\s*\/\/.*$/gm, "") // line comments
    .replace(/,(\s*[}\]])/g, "$1"); // trailing commas
  return JSON.parse(raw).vars ?? {};
};

const secretNames = () => {
  const r = spawnSync(process.execPath, [WRANGLER, "secret", "list"], {
    encoding: "utf8",
  });
  return [...(r.stdout || "").matchAll(/"name":\s*"([A-Z_]+)"/g)].map(
    (m) => m[1],
  );
};

function counts() {
  const rows = sql(
    `SELECT environment, status, COUNT(*) AS n FROM bids GROUP BY environment, status`,
  );
  const events = sql(`SELECT COUNT(*) AS n FROM payment_events`)[0]?.n ?? 0;
  const transitions =
    sql(`SELECT COUNT(*) AS n FROM bid_transitions`)[0]?.n ?? 0;
  return { rows, events: Number(events), transitions: Number(transitions) };
}

function report() {
  const vars = config();
  const secrets = secretNames();
  const mode = vars.DODO_ENVIRONMENT;
  const { rows, events, transitions } = counts();

  console.log(`mode:            ${mode}`);
  console.log(`product id:      ${vars.DODO_BID_PRODUCT_ID || "(missing)"}`);
  console.log(`business id:     ${vars.DODO_BUSINESS_ID || "(missing)"}`);
  console.log(
    `secrets present: ${["DODO_PAYMENTS_API_KEY", "DODO_PAYMENTS_WEBHOOK_KEY"].map((s) => `${s}=${secrets.includes(s) ? "yes" : "NO"}`).join("  ")}`,
  );
  console.log(
    `payments enabled: ${Boolean(vars.DODO_BID_PRODUCT_ID && secrets.includes("DODO_PAYMENTS_API_KEY") && secrets.includes("DODO_PAYMENTS_WEBHOOK_KEY"))}`,
  );
  console.log("\nbids by environment/status:");
  if (!rows.length) console.log("  (none)");
  for (const r of rows)
    console.log(
      `  ${r.environment.padEnd(10)} ${String(r.status).padEnd(10)} ${r.n}`,
    );
  console.log(`payment_events: ${events}   bid_transitions: ${transitions}`);

  if (mode === "live_mode" && rows.some((r) => r.environment === TEST)) {
    console.log(
      "\nYou are in live mode with test data still in the database. Run: node scripts-golive.mjs clean-test --yes",
    );
  }
}

function cleanTest({ apply }) {
  const bids = sql(`SELECT * FROM bids WHERE environment = '${TEST}'`);
  if (!bids.length) {
    console.log("no test-mode data to clean.");
    return;
  }
  const ids = bids.map((b) => b.id);
  const inList = ids.map((i) => `'${i.replace(/'/g, "")}'`).join(",");
  const transitions = sql(
    `SELECT * FROM bid_transitions WHERE bid_id IN (${inList})`,
  );
  const events = sql(
    `SELECT * FROM payment_events WHERE bid_id IN (${inList})`,
  );

  console.log(`test-mode bids:     ${bids.length}`);
  console.log(`their transitions:  ${transitions.length}`);
  console.log(`their events:       ${events.length}`);
  const paid = bids.filter((b) => b.status === "paid").length;
  if (paid)
    console.log(
      `(${paid} of the bids are test-mode 'paid' listings — they leave the board once removed)`,
    );

  if (!apply) {
    console.log(
      "\nDry run. Nothing was deleted. Re-run with --yes to back up and delete.",
    );
    return;
  }

  mkdirSync("backups", { recursive: true });
  const file = path.join(
    "backups",
    `test-data-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );
  writeFileSync(
    file,
    JSON.stringify(
      { exported_at: new Date().toISOString(), bids, transitions, events },
      null,
      2,
    ),
  );
  console.log(`\nbacked up to ${file}`);

  sql(`DELETE FROM bid_transitions WHERE bid_id IN (${inList})`);
  sql(`DELETE FROM payment_events WHERE bid_id IN (${inList})`);
  sql(`DELETE FROM bids WHERE environment = '${TEST}'`);

  const left =
    sql(`SELECT COUNT(*) AS n FROM bids WHERE environment = '${TEST}'`)[0]?.n ??
    0;
  console.log(`deleted. test-mode bids remaining: ${left}`);
  console.log(
    "The board is cached for 30s at the edge, so it clears within a minute.",
  );
}

const cmd = process.argv[2] || "check";
if (cmd === "check") report();
else if (cmd === "clean-test")
  cleanTest({ apply: process.argv.includes("--yes") });
else {
  console.log("usage: node scripts-golive.mjs [check|clean-test [--yes]]");
  process.exit(1);
}
