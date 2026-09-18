import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

// Every page is prerendered at build time. Serve that HTML from static assets and intercept
// the request before the Next.js server loads, so a page view costs ~1–2ms of CPU instead of a
// full React render. Without this, `/` and `/about` exceeded the Workers CPU limit (error 1102).
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
  enableCacheInterception: true,
});
