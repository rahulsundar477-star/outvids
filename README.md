# Outvids

A vertical feed of AI-generated reels at [outvids.lol](https://outvids.lol). Viewers swipe, give an **Outvid** (a vote) to the reels they like, and brands **Outbid** each other for the #1 sponsor slot that runs on every reel.

## Stack

- **Next.js 16** (app router), React 19, TypeScript, plain CSS.
- **Cloudflare Workers** via `@opennextjs/cloudflare`. `worker.ts` is the entry point: it serves the hot paths and payments as plain Worker code, passes everything else to Next.js, and runs the hourly cron.
- **R2** (`clips`) holds the videos, the catalog and the ranked `feed.json`.
- **D1** (`outvids`) holds votes, ranking snapshots and Outbid payments.
- **Analytics Engine** takes one watch beacon per clip leave.
- **Dodo Payments** (merchant of record) runs Outbid checkout. Currently in test mode.

## How it fits together

| Path                                                                        | Served by            | Notes                                                        |
| --------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------ |
| `/feed.json`                                                                | `server/hotpath.ts`  | One ranked list, edge-cached. The phone shuffles it locally. |
| `/api/stream/:id`                                                           | `server/hotpath.ts`  | mp4 from R2, Range-aware, edge-cached.                       |
| `/api/vote`                                                                 | `app/api/vote`       | One Outvid per viewer per clip (D1).                         |
| `/api/beacon`                                                               | `app/api/beacon`     | One data point per clip leave.                               |
| `/api/board`, `/api/checkout`, `/api/checkout/status`, `/api/webhooks/dodo` | `server/payments.ts` | Outbid money paths.                                          |
| `/api/rerank`                                                               | `app/api/rerank`     | Re-run ranking after an upload (bearer token).               |
| cron `0 * * * *`                                                            | `worker.ts`          | Re-rank the feed and reconcile pending payments.             |

Ranking lives in `lib/rank.ts`: Bayesian completion and skip rates, the Outvid rate, and a UCB-style explore bonus for clips few people have seen.

## Commands

```bash
npm run dev            # localhost:3100 (uses the production R2 and D1)
npm run dev:seed       # sample listings + the live feed into the LOCAL stores
npm run dev:local      # localhost:3100 on local data only, hot reload, nothing can reach production
npm run test:payments  # 23 payment scenarios, isolated SQLite + mocked Dodo
npm run deploy         # OpenNext build + wrangler deploy
npm run indexnow       # ping IndexNow after a deploy that changes pages
npm run usage          # usage against the free allowances (see docs/runbook.md)
npm run panic          # kill switch: serve a static page from a Worker with no bindings
npm run resume         # put the app back
npm run security:reports  # read the inbox behind outvids.lol/security
npm run scan:secrets   # every file and every commit, values masked (also part of npm test)
```

## Configuration

Secrets are Cloudflare Worker secrets and are never committed: `DODO_PAYMENTS_API_KEY`, `DODO_PAYMENTS_WEBHOOK_KEY`, `RERANK_TOKEN`, `CF_ANALYTICS_TOKEN`. Local development reads `.dev.vars` (gitignored). Non-secret settings live in `wrangler.jsonc`.

More detail: [`docs/payments.md`](docs/payments.md), [`docs/db-schema.md`](docs/db-schema.md) and [`CLAUDE.md`](CLAUDE.md).
