/**
 * Poster images: the first frame of every reel as a small WebP in R2 (posters/<id>.webp).
 *
 * The first reel's first frame is what Largest Contentful Paint waits for. With a poster the phone
 * paints a ~50 KB image instead of waiting for a multi-megabyte video to decode, then the video takes
 * over on the same frame, so nothing visibly jumps.
 *
 *   npm run posters                 make and upload posters for clips that don't have one yet
 *   npm run posters -- --only 3     try the first 3 (look at .posters/ before doing the rest)
 *   npm run posters -- --force      redo all of them
 *
 * ffmpeg reads each video straight from outvids.lol/api/stream with range requests, so it only pulls
 * the bytes it needs for frame 0 — not the whole file. Uploads go through wrangler (your login).
 * Then POST /api/rerank (or wait for the hourly cron) so feed.json starts pointing at them.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ORIGIN = "https://outvids.lol";
const DIR = join(import.meta.dirname, ".posters");
const WIDTH = 720; // 9:16 at 720x1280: sharp enough for the moment it's on screen, small enough to be first
const QUALITY = 70;

const args = process.argv.slice(2);
const only = args.includes("--only")
  ? Number(args[args.indexOf("--only") + 1]) || 3
  : Infinity;
const force = args.includes("--force");
mkdirSync(DIR, { recursive: true });

const feed = await (await fetch(`${ORIGIN}/feed.json`)).json();
const ids = feed.clips.map((c) => c.id).slice(0, only);
console.log(`${ids.length} clips${force ? " (forced)" : ""}\n`);

// What R2 already has, so a rerun only does the new ones.
const existing = new Set();
if (!force) {
  const r = spawnSync(
    process.execPath,
    [
      join(import.meta.dirname, "node_modules/wrangler/bin/wrangler.js"),
      "r2",
      "object",
      "get",
      "clips/posters/index.json",
      "--remote",
      "--pipe",
    ],
    { encoding: "utf8" },
  );
  try {
    for (const id of JSON.parse(r.stdout)) existing.add(id);
  } catch {
    // no index yet: first run
  }
}

let made = 0,
  skipped = 0,
  failed = 0,
  bytes = 0;
const done = new Set(existing);

for (const id of ids) {
  if (existing.has(id)) {
    skipped++;
    continue;
  }
  const out = join(DIR, `${id}.webp`);
  const ff = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-y",
      "-i",
      `${ORIGIN}/api/stream/${id}`,
      "-frames:v",
      "1",
      "-vf",
      `scale=${WIDTH}:-2:flags=lanczos`,
      "-c:v",
      "libwebp",
      "-quality",
      String(QUALITY),
      out,
    ],
    { encoding: "utf8" },
  );
  if (ff.status !== 0 || !existsSync(out)) {
    failed++;
    console.log(
      `  x ${id}: ${(ff.stderr || "ffmpeg failed").trim().split("\n").pop()}`,
    );
    continue;
  }
  const size = statSync(out).size;
  const up = spawnSync(
    process.execPath,
    [
      join(import.meta.dirname, "node_modules/wrangler/bin/wrangler.js"),
      "r2",
      "object",
      "put",
      `clips/posters/${id}.webp`,
      "--remote",
      "--file",
      out,
      "--content-type",
      "image/webp",
      "--cache-control",
      "public, max-age=31536000, immutable",
    ],
    { encoding: "utf8" },
  );
  if (up.status !== 0) {
    failed++;
    console.log(`  x ${id}: upload failed`);
    continue;
  }
  made++;
  bytes += size;
  done.add(id);
  console.log(`  ✓ ${id}  ${(size / 1024).toFixed(0)} KB`);
}

// The index is what the re-rank reads: one small object instead of listing the bucket every hour.
if (made > 0) {
  const indexFile = join(DIR, "index.json");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(indexFile, JSON.stringify([...done].sort()));
  spawnSync(
    process.execPath,
    [
      join(import.meta.dirname, "node_modules/wrangler/bin/wrangler.js"),
      "r2",
      "object",
      "put",
      "clips/posters/index.json",
      "--remote",
      "--file",
      indexFile,
      "--content-type",
      "application/json",
      "--cache-control",
      "no-store",
    ],
    { encoding: "utf8" },
  );
}

console.log(
  `\n${made} made${made ? ` (avg ${(bytes / made / 1024).toFixed(0)} KB)` : ""}, ${skipped} already there, ${failed} failed.` +
    (made
      ? "\nNext: re-rank so feed.json points at them (hourly cron, or POST /api/rerank with RERANK_TOKEN)."
      : ""),
);
