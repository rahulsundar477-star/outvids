// Bundles tests/payments.test.ts with esbuild (swapping `dodopayments` for the network mock) and runs it in Node.
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, ".tests", "payments.test.mjs");
mkdirSync(path.dirname(out), { recursive: true });

await build({
  absWorkingDir: root,
  entryPoints: ["tests/payments.test.ts"],
  outfile: out,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  logLevel: "warning",
  external: ["node:*"],
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  plugins: [
    {
      name: "dodo-mock",
      setup(b) {
        b.onResolve({ filter: /^dodopayments$/ }, (args) =>
          args.importer.endsWith(path.join("tests", "dodo-mock.ts"))
            ? undefined
            : { path: path.join(root, "tests", "dodo-mock.ts") },
        );
        b.onResolve({ filter: /^dodopayments-real$/ }, () => ({
          path: path.join(root, "node_modules", "dodopayments", "index.mjs"),
        }));
      },
    },
  ],
});

const run = spawnSync(process.execPath, ["--no-warnings", out], {
  cwd: root,
  stdio: "inherit",
});
process.exit(run.status ?? 1);
