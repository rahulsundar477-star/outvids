// Pull a read-only local copy of the live D1 database (votes, clip_scores, rank_runs) for the `db` MCP server.
// Run: npm run db:snapshot   →   outvids/.data/outvids-d1.sqlite
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

const dir = join(import.meta.dirname, ".data");
const sqlFile = join(dir, "outvids-d1.sql");
const dbFile = join(dir, "outvids-d1.sqlite");
mkdirSync(dir, { recursive: true });

execFileSync(
  process.execPath,
  [join(import.meta.dirname, "node_modules/wrangler/bin/wrangler.js"), "d1", "export", "outvids", "--remote", `--output=${sqlFile}`],
  { stdio: ["ignore", "ignore", "inherit"] },
);

rmSync(dbFile, { force: true });
const db = new DatabaseSync(dbFile);
db.exec(readFileSync(sqlFile, "utf8"));
const counts = ["votes", "clip_scores", "rank_runs"].map((t) => `${t}=${db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n}`);
db.close();
rmSync(sqlFile, { force: true });
console.log(`D1 snapshot → ${dbFile} (${counts.join(", ")}) at ${new Date().toISOString()}`);
