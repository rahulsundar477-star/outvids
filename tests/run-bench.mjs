// Bundles tests/bench-enrich.ts with esbuild and runs it in Node. See that file for what it measures.
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, ".tests", "bench-enrich.mjs");
mkdirSync(path.dirname(out), { recursive: true });

await build({
  absWorkingDir: root,
  entryPoints: ["tests/bench-enrich.ts"],
  outfile: out,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  logLevel: "warning",
  external: ["node:*"],
});

const run = spawnSync(process.execPath, ["--no-warnings", out], { cwd: root, stdio: "inherit" });
process.exit(run.status ?? 1);
