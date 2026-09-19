import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// `npm run dev:local` sets this. It keeps every binding on disk (wrangler.local.jsonc) instead of
// the production R2 and D1, and borrows the local Worker on :8787 for the routes that only exist
// there (the board, brand icons, the feed and the video stream all run as plain Worker code).
const local = process.env.OUTVIDS_LOCAL === "1";
const WORKER = "http://127.0.0.1:8787";

const nextConfig: NextConfig = local
  ? {
      async rewrites() {
        // beforeFiles: some of these also exist as Next routes (for plain `next dev`), and locally
        // we want the real Worker code to answer them, exactly as production does.
        return {
          beforeFiles: [
            { source: "/api/board", destination: `${WORKER}/api/board` },
            { source: "/api/checkout", destination: `${WORKER}/api/checkout` },
            {
              source: "/api/checkout/status",
              destination: `${WORKER}/api/checkout/status`,
            },
            {
              source: "/api/icon/:key*",
              destination: `${WORKER}/api/icon/:key*`,
            },
            { source: "/feed.json", destination: `${WORKER}/feed.json` },
            {
              source: "/api/stream/:id*",
              destination: `${WORKER}/api/stream/:id*`,
            },
          ],
        };
      },
    }
  : {};

export default nextConfig;

// Exposes Cloudflare bindings (getCloudflareContext) during `next dev`.
initOpenNextCloudflareForDev(
  local ? { configPath: "wrangler.local.jsonc" } : undefined,
);
