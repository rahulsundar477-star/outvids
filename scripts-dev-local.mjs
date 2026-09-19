/**
 * `npm run dev:local` — the whole app on local data, with hot reload.
 *
 * Plain `npm run dev` binds to the PRODUCTION R2 and D1 (wrangler.jsonc marks both `remote: true`),
 * so a vote or a re-rank on localhost lands in live data. This script instead:
 *   1. starts the Worker on :8787 against wrangler.local.jsonc (on-disk bindings, no remote anything), and
 *   2. starts `next dev` on :3100 with OUTVIDS_LOCAL=1, which points Next at the same local bindings
 *      and proxies /api/board, /api/icon, /feed.json and /api/stream to that Worker (see next.config.ts).
 *
 * Seed the local stores first: node scripts-local-seed.mjs
 */
import { spawn } from "node:child_process";

const wrangler = spawn(
  process.execPath,
  [
    "node_modules/wrangler/bin/wrangler.js",
    "dev",
    "--config",
    "wrangler.local.jsonc",
    "--persist-to",
    ".wrangler/state",
    "--port",
    "8787",
  ],
  { stdio: "inherit", env: process.env },
);

const next = spawn("npx", ["next", "dev", "-p", "3100"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, OUTVIDS_LOCAL: "1" },
});

const stop = () => {
  wrangler.kill();
  next.kill();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
wrangler.on("exit", () => next.kill());
next.on("exit", (code) => {
  wrangler.kill();
  process.exit(code ?? 0);
});
