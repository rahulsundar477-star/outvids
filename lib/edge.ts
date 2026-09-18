/** Server-only helpers for route handlers running on the Worker. */
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const cf = () => getCloudflareContext();

/** Cloudflare's edge cache. Undefined under plain `next dev` (Node), where we just skip caching. */
export function edgeCache(): Cache | undefined {
  const c = (globalThis as { caches?: CacheStorage & { default?: Cache } }).caches;
  return c?.default;
}
