# Outvids: project context

outvids.lol is a vertical feed of AI-generated reels. Viewers swipe, give an **Outvid** (vote) to the reels they like, and brands **Outbid** for the #1 sponsor slot.
It's a solo project, mobile-first, and every video is 9:16.

## Stack

- **App:** Next.js 16 (app router) · React 19 · TypeScript. Plain CSS in `app/globals.css` with inline styles, and no Tailwind.
- **Hosting:** Cloudflare Workers through `@opennextjs/cloudflare`, as Worker `outvids` on outvids.lol. `worker.ts` wraps the build and adds the cron.
- **Data:** R2 `clips` holds videos, manifest.json and feed.json. D1 `outvids` holds votes and scores. Analytics Engine gets the beacons.
- **Upstream:** clips are rendered and judged in `../platform` and uploaded with `platform/upload_r2.py`.
- **No accounts.** The viewer is a per-device id in localStorage.
- **Payments:** Outbid checkout runs on Dodo Payments, currently in **test mode**. Read `docs/payments.md` before touching money code.

## Commands

- `npm run dev` runs on :3100 and hits the **production** R2 and D1 (`remote: true`).
- `npm run dev:local` runs the same app on :3100 against **local** R2, D1 and cache only (`wrangler.local.jsonc`), with the Worker on :8787 answering the board, icons, feed and stream.
- `npm run dev:seed` fills those local stores with sample listings and the live ranked feed.
- `npm run deploy` builds with OpenNext and runs wrangler deploy.
- `npm run db:snapshot` refreshes the read-only D1 copy the `db` MCP reads.
- `npm run indexnow` pings Bing and others after a deploy that changes pages.
- `npm run cf-typegen` goes after any wrangler.jsonc change.

## Architecture law (don't redesign without asking)

- **Hot path is cache.** A phone downloads one `/feed.json`, and the mp4s come from R2 through the edge cache. Don't query D1 on the swipe path, and don't add per-request personalized ranking.
- **The cron owns ranking** (`lib/rank.ts`, hourly, plus `POST /api/rerank` after uploads). The player only shuffles: seeded, weighted, with no repeats in a session.
- **Votes are product law.** Two numbers do two jobs:
  - the public Outvid count is the real unique count from D1;
  - the feed order is internal: completion, skip, vote rate and explore.
  - Never rank on watch time alone, and never ship a feed that ignores Outvids.
- **One beacon per leave,** never a stream of `timeupdate`.
- **Weak formats are held back, not deleted.** `isHeldBack()` in `lib/rank.ts` flags a cohort (today: older-cast interview/gameshow Q&A in the pod and rc tracks, 7 clips) as `hold: 1` in feed.json, and `gateHeld()` in `lib/shuffle.ts` keeps those out of every viewer's first 100 reels, then sprinkles them one per 15. A shared `?clip=` link still opens a held clip. Edit the cohort in that one function, then re-rank. `npm run test:feed` guards the rule.
- **The in-feed Outbid slide** (`components/PromoSlide.tsx`) sits at seeded positions from `lib/promo.ts`: first after 3-4 reels, then 6-12 apart, different per viewer per day. It carries no video, no watch tracking and no extra request — it reuses the loaded board.
- **The intro card** (`components/IntroCard.tsx`) shows once per device, 2.2s after the first reel, and is remembered in `device.intro`.

## Hard rules

- **NEVER hardcode secrets.**
  - `RERANK_TOKEN` lives in `.dev.vars` and as a wrangler secret.
  - The R2 keys live in `platform/.env`.
  - `CF_ANALYTICS_TOKEN` is a wrangler secret.
  - `DODO_PAYMENTS_API_KEY` and `DODO_PAYMENTS_WEBHOOK_KEY` are wrangler secrets.
- **NEVER show fake numbers.** Flames, streaks, crew, board and stats start at 0 and only count real events. The user had every placeholder zeroed.
- **NEVER say a payment happened unless the server verified it.** Only a `paid` bid in D1 counts; never trust Dodo's `?status=` return param. When checkout fails or is off, the copy must say nothing was charged.
- **Money code changes need `npm run test:payments` green.** `server/payments.ts` is plain Worker code routed in `worker.ts`: never move it into Next.js route handlers (CPU limit).
- **Test-mode listings must be labelled** and must never sponsor the feed.
- **Dev writes to production.** A vote or rerank under `npm run dev` lands in live D1. Use `npm run dev:local` for anything that writes, or delete the test data afterwards and say so.
- **UI work belongs in `npm run dev:local`.** It has hot reload and sample listings, and it cannot reach production: no binding in `wrangler.local.jsonc` is remote. Switch its `DODO_ENVIRONMENT` to `live_mode` to see the board and feed as they look after go-live.
- **Stop `next dev` before `npm run deploy`.** Its workerd process locks `.open-next`, and the build fails with EPERM (Windows).
- **After a deploy, read the bindings list.** Confirm `env.CLIPS`, `env.DB` and the cron are there. The first deploy went out without the API and the user saw "videos are not coming".
- **Don't name a Worker var `CF_ACCOUNT_ID`.** Wrangler hijacks that name as its own account setting. Use `OUTVIDS_ACCOUNT_ID`.
- **Analytics Engine must be enabled in the dashboard before the binding is uncommented.** Otherwise the deploy fails with code 10089.
- **Videos need the `muted` attribute set on the element** (not only the prop) and `playsInline`, or iOS won't autoplay.
- **Cloudflare has no spend limit.** The free plan refuses instead of billing, except R2, which is
  metered. Read `docs/runbook.md` before adding anything that writes to R2, and keep unauthenticated
  endpoints behind `edgeLimit()` in `server/limit.ts` — the platform's rate limiting binding is
  permissive by design and let 40 requests through a 10/min limit in a live test.
- **`npm run panic`** swaps the app for `maintenance.ts` (no bindings) in ~20s; `npm run resume` restores it.
- **Handle API routes by hand.** `/api/*` stays `Disallow` in robots, and new utility pages get `robots: { index: false, follow: false }`. Public pages go in `app/sitemap.ts`, then run `npm run indexnow`.

## Verify before "done"

- **After ANY UI change,** check it in a browser at **320px, 375px and 430px** and in landscape, looking for horizontal overflow and tap targets under 32px, then report what was checked.
  - The built-in browser pane is often hidden, so video playback, rAF and scroll don't advance there. Use synthetic events, the `browser` MCP (Playwright), or curl. Don't call a hidden-pane stall a bug.
- **After an API change,** curl the live endpoint after deploy. Check `/feed.json` (200 plus ETag), `/api/stream/<id>` with a Range header (206), and that `/api/rerank` without a token returns 401.
- **In Git Bash,** set `MSYS_NO_PATHCONV=1` before passing `/c` or `/path` arguments to Windows tools, or they get mangled.

## Design

- **Tokens:** the dark palette tokens in `:root` of `globals.css` (accent `#FF4D1C`, bg `#0B0A0A`), Instrument Sans, and the flame icon as the mark.
- **Motion:** use the `transitions-polish` tokens (`--duration-*`, `--ease-*`). Closes are faster than opens, staggers are 40ms, and prefers-reduced-motion is respected.
- **Mobile:** respect safe-area insets, use `100dvh`, keep inputs at 16px or larger, and gate hover behind `(hover: hover)`.
- **Design source:** the exports in the user Downloads folder. `Outvids App.html` holds the current board spec (row = logo, then rank + name + price on one line, tagline under it, meta row, then the Outbid pill); `Outvids.dc.html` is the standalone feed export.

## Voice

Casual and direct. Short sentences. Lead with what changed and what the user must do. No corporate fluff, and no claims that weren't verified.

## Imports

@docs/db-schema.md
