/**
 * Worker entry.
 * - Payments routes (/api/checkout, /api/checkout/status, /api/webhooks/dodo, /api/board) and the
 *   security report inbox (/api/security-report) run as plain Worker
 *   code, before Next.js loads, so money paths never hit the CPU limit.
 * - The swipe hot path (/feed.json, /api/stream/:id) also runs as plain Worker code (server/hotpath.ts).
 * - Everything else goes to the OpenNext-built Next.js app (`.open-next/worker.js`, generated at build time).
 * - Cron (hourly): re-rank the feed, and reconcile pending payments whose webhook never arrived.
 */
// @ts-ignore generated at build time
import { default as handler } from "./.open-next/worker.js";
import { rerank } from "./lib/rank";
import { enrichPending } from "./server/enrich";
import { handleHotPath, isHotPath } from "./server/hotpath";
import { handleSecurity, isSecurityRoute } from "./server/security";
import {
  handlePayments,
  isPaymentsRoute,
  reconcilePayments,
} from "./server/payments";

const FEED_URL = "https://outvids.lol/feed.json";

// Set on every response unless a route already chose its own value. No script-src here: Next.js
// inlines its bootstrap scripts, and a CSP that breaks the app protects nothing.
const SECURITY_HEADERS: [string, string][] = [
  ["Strict-Transport-Security", "max-age=31536000; includeSubDomains"],
  ["X-Content-Type-Options", "nosniff"],
  ["X-Frame-Options", "DENY"], // nobody can frame the pay button (clickjacking)
  ["Content-Security-Policy", "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'"],
  ["Referrer-Policy", "strict-origin-when-cross-origin"],
  ["Permissions-Policy", "camera=(), microphone=(), geolocation=(), usb=(), browsing-topics=()"],
  ["Cross-Origin-Opener-Policy", "same-origin"],
];

function secure(res: Response): Response {
  if (SECURITY_HEADERS.every(([k]) => res.headers.has(k))) return res;
  // Copy: responses from fetch() and the cache can have immutable headers. The body streams through.
  const out = new Response(res.body, res);
  for (const [k, v] of SECURITY_HEADERS) if (!out.headers.has(k)) out.headers.set(k, v);
  return out;
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (isHotPath(pathname)) return secure(await handleHotPath(request, env, ctx));
    if (isPaymentsRoute(pathname)) return secure(await handlePayments(request, env, ctx));
    if (isSecurityRoute(pathname)) return secure(await handleSecurity(request, env));
    return secure(await handler.fetch(request, env, ctx));
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      (async () => {
        const [ranked, reconciled, enriched] = await Promise.allSettled([
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
          enrichPending(env),
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
            enrich:
              enriched.status === "fulfilled"
                ? enriched.value
                : { error: String(enriched.reason) },
          }),
        );
      })(),
    );
  },
} satisfies ExportedHandler<CloudflareEnv>;
