/**
 * Worker entry.
 * - Payments routes (/api/checkout, /api/checkout/status, /api/webhooks/dodo, /api/board) run as plain Worker
 *   code, before Next.js loads, so money paths never hit the CPU limit.
 * - The swipe hot path (/feed.json, /api/stream/:id) also runs as plain Worker code (server/hotpath.ts).
 * - Everything else goes to the OpenNext-built Next.js app (`.open-next/worker.js`, generated at build time).
 * - Cron (hourly): re-rank the feed, and reconcile pending payments whose webhook never arrived.
 */
// @ts-ignore generated at build time
import { default as handler } from "./.open-next/worker.js";
import { rerank } from "./lib/rank";
import { handleHotPath, isHotPath } from "./server/hotpath";
import {
  handlePayments,
  isPaymentsRoute,
  reconcilePayments,
} from "./server/payments";

const FEED_URL = "https://outvids.lol/feed.json";

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (isHotPath(pathname)) return handleHotPath(request, env, ctx);
    if (isPaymentsRoute(pathname)) return handlePayments(request, env, ctx);
    return handler.fetch(request, env, ctx);
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      (async () => {
        const [ranked, reconciled] = await Promise.allSettled([
          rerank(env, "cron").then(async (r) => {
            await (caches as unknown as { default: Cache }).default.delete(
              FEED_URL,
            );
            return {
              source: r.feed.source,
              count: r.feed.count,
              ms: r.ms,
              statsError: r.statsError,
            };
          }),
          reconcilePayments(env),
        ]);
        console.log(
          JSON.stringify({
            cron: "hourly",
            rerank:
              ranked.status === "fulfilled"
                ? ranked.value
                : { error: String(ranked.reason) },
            payments:
              reconciled.status === "fulfilled"
                ? reconciled.value
                : { error: String(reconciled.reason) },
          }),
        );
      })(),
    );
  },
} satisfies ExportedHandler<CloudflareEnv>;
