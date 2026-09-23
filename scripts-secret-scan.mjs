/**
 * Secret scan for a public repo: every tracked file, plus every file version in every commit.
 *
 *   npm run scan:secrets      (also runs as part of `npm test`)
 *
 * It never prints a secret — only the rule, where it is, and a masked hint (first 4 characters and
 * the length). Exit code 1 on any finding, so it can gate a push.
 *
 * It also fails on raw control characters in source files: a NUL byte makes tools treat a file as
 * binary and skip it, which is exactly how a scanner misses things.
 */
import { execFileSync } from "node:child_process";

const RULES = [
  ["private-key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["aws-access-key", /\b(AKIA|ASIA)[0-9A-Z]{16}\b/],
  [
    "github-token",
    /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}/,
  ],
  ["google-api-key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["slack-token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["stripe-style-key", /\b(sk|rk)_(live|test)_[A-Za-z0-9]{16,}/],
  ["webhook-secret", /\bwhsec_[A-Za-z0-9+/=]{20,}/],
  ["jwt", /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["dodo-style-key", /\b[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{40,}\b/],
  ["url-with-password", /[a-z][a-z0-9+.-]*:\/\/[^\s/:@"']+:[^\s/@"']{6,}@/i],
  [
    "assigned-secret",
    /\b[\w.-]*(api[_-]?key|secret|token|passwd|password|bearer|access[_-]?key|private[_-]?key)[\w.-]*\s*[:=]\s*["'`]([^"'`\s]{16,})["'`]/i,
  ],
];

// Deliberate, non-secret values: test fixtures built from obvious literals.
const ALLOW = [
  /sk_test_mock/,
  /outvids-test-webhook-secret/,
  /correct-horse-battery-staple/,
];

const BINARY_EXT =
  /\.(png|jpe?g|webp|gif|ico|woff2?|ttf|otf|mp4|webm|zip|gz)$/i;
const SOURCE_EXT =
  /\.(ts|tsx|js|mjs|cjs|json|jsonc|md|css|sql|html|txt|yml|yaml|toml)$/i;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

const git = (...args) =>
  execFileSync("git", args, {
    encoding: "buffer",
    maxBuffer: 256 * 1024 * 1024,
  });
const mask = (v) => `${v.trim().slice(0, 4)}…(${v.trim().length} chars)`;

const findings = new Map(); // dedupe by rule+file+line+hint
function scan(text, where, file) {
  // Current files only: this scanner reads historical versions either way, and the point is to keep
  // new code readable by every other tool.
  if (where === "index" && SOURCE_EXT.test(file) && CONTROL.test(text)) {
    const line = text.slice(0, text.search(CONTROL)).split("\n").length;
    findings.set(`ctrl:${file}:${line}`, [
      "control-bytes",
      where,
      file,
      line,
      "raw control character",
    ]);
  }
  text.split("\n").forEach((line, i) => {
    for (const [rule, rx] of RULES) {
      const m = line.match(rx);
      if (!m || ALLOW.some((a) => a.test(m[0]))) continue;
      const value = m[2] ?? m[0];
      findings.set(`${rule}:${file}:${i + 1}:${mask(value)}`, [
        rule,
        where,
        file,
        i + 1,
        mask(value),
      ]);
    }
  });
}

// 1) the files as they are now
const tracked = git("ls-files", "-z")
  .toString("utf8")
  .split("\0")
  .filter(Boolean);
for (const file of tracked) {
  if (BINARY_EXT.test(file)) continue;
  try {
    scan(git("show", `:${file}`).toString("utf8"), "index", file);
  } catch {
    // deleted in the working tree but still staged: history covers it
  }
}

// 2) every version of every file in history
const seen = new Set();
let blobs = 0;
for (const commit of git("rev-list", "--all")
  .toString("utf8")
  .split("\n")
  .filter(Boolean)) {
  for (const row of git("ls-tree", "-r", "-z", commit)
    .toString("utf8")
    .split("\0")
    .filter(Boolean)) {
    const [meta, file] = row.split("\t");
    const [, type, sha] = meta.split(" ");
    if (type !== "blob" || seen.has(sha) || BINARY_EXT.test(file)) continue;
    seen.add(sha);
    blobs++;
    scan(git("cat-file", "-p", sha).toString("utf8"), commit.slice(0, 7), file);
  }
}

if (!findings.size) {
  console.log(
    `PASS  secret scan: ${tracked.length} tracked files and ${blobs} historical file versions, nothing found`,
  );
  process.exit(0);
}
console.log(
  `FAIL  secret scan: ${findings.size} finding(s) — values are masked`,
);
for (const [rule, where, file, line, hint] of findings.values())
  console.log(
    `      ${rule.padEnd(18)} ${where.padEnd(7)} ${file}:${line}  ${hint}`,
  );
console.log(
  "      If a real secret is in history, rotate it first, then rewrite history before pushing.",
);
process.exit(1);
