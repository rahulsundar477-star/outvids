/**
 * Read the security inbox (reports sent from outvids.lol/security).
 *
 *   npm run security:reports              newest 20 reports, full text
 *   npm run security:reports -- --new     only the ones still marked 'new'
 *   npm run security:reports -- --mark sr_1234abcd triaged|fixed|invalid
 *
 * Read-only unless you pass --mark. Talks to the production D1 through wrangler (your login).
 */
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const markAt = args.indexOf("--mark");

function d1(sql) {
  const r = spawnSync(
    process.execPath,
    [
      "node_modules/wrangler/bin/wrangler.js",
      "d1",
      "execute",
      "outvids",
      "--remote",
      "--json",
      "--command",
      sql,
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout);
    process.exit(1);
  }
  return JSON.parse(r.stdout)[0]?.results ?? [];
}

if (markAt >= 0) {
  const [id, status] = [args[markAt + 1], args[markAt + 2]];
  if (
    !/^sr_[0-9a-f]{16}$/.test(id || "") ||
    !["new", "triaged", "fixed", "invalid"].includes(status || "")
  ) {
    console.error(
      "usage: npm run security:reports -- --mark sr_<16 hex> new|triaged|fixed|invalid",
    );
    process.exit(1);
  }
  d1(`UPDATE security_reports SET status = '${status}' WHERE id = '${id}'`);
  console.log(`${id} → ${status}`);
  process.exit(0);
}

const where = args.includes("--new") ? "WHERE status = 'new'" : "";
const rows = d1(
  `SELECT id, status, summary, details, url, contact, user_agent, created_at
     FROM security_reports ${where} ORDER BY created_at DESC LIMIT 20`,
);
const [{ n: open } = { n: 0 }] = d1(
  "SELECT COUNT(*) AS n FROM security_reports WHERE status = 'new'",
);

console.log(`${open} new report(s).\n`);
if (!rows.length) console.log("Inbox empty.");
for (const r of rows) {
  console.log(
    `── ${r.id}  [${r.status}]  ${new Date(r.created_at).toISOString().replace("T", " ").slice(0, 16)} UTC`,
  );
  console.log(`   ${r.summary}`);
  if (r.url) console.log(`   url:     ${r.url}`);
  if (r.contact) console.log(`   reply:   ${r.contact}`);
  console.log(`   agent:   ${r.user_agent || "-"}`);
  console.log(
    String(r.details)
      .split("\n")
      .map((l) => `   │ ${l}`)
      .join("\n"),
  );
  console.log("");
}
