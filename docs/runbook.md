# Runbook: cost, limits and the kill switch

Cloudflare has **no hard spend limit**. The guardrails are: stay on the free plan, cap what strangers
can make the app do, watch the counters, and be able to stop the app in seconds.

## What can actually bill us

| Service                | Free allowance                 | Past it, on our plan                     |
| ---------------------- | ------------------------------ | ---------------------------------------- |
| Workers requests       | 100,000/day                    | **Requests are refused, not billed.**    |
| Workers CPU            | 10 ms per invocation           | The invocation is killed (error 1102).   |
| D1 rows read / written | 5M / 100k per day, 5 GB stored | Queries fail; free plan doesn't bill.    |
| R2 storage             | 10 GB-month                    | **Billed**, ~$0.015 per GB-month.        |
| R2 class A (writes)    | 1M/month                       | **Billed**, ~$4.50 per million.          |
| R2 class B (reads)     | 10M/month                      | **Billed**, ~$0.36 per million.          |
| R2 egress              | unlimited                      | Free — this is why the videos live here. |

So on the free plan the only service that can quietly cost money is **R2**, and only past its monthly
allowance. Everything else stops instead of spending. (Rates change: check
developers.cloudflare.com/r2/pricing before trusting the numbers above.)

**Where we are today (2026-09-20):** R2 holds 282 objects and 1.51 GB — 15% of the storage allowance —
and every video is served with `Cache-Control: immutable` for a year, so repeat views are answered by
the edge cache and never reach R2 at all.

## Set the alert (5 minutes, do this once)

Cloudflare can't cap spend, but it will tell you:

1. dash.cloudflare.com → **Manage Account → Notifications → Add**.
2. **Billing usage alert** — pick the services and a threshold (start low, e.g. 75% of an allowance).
3. Add your email, save.
4. Also add **Workers → Usage Notification** if you ever move to the paid plan.

An alert is only useful if you can act on it, which is what the rest of this page is for.

## Watch the counters

```bash
npm run usage           # requests/day, D1 rows, R2 storage and ops, against the free allowances
```

With no API token it prints where to look in the dashboard instead. To get the numbers, create a
read-only token (My Profile → API Tokens → Custom token → Account · Account Analytics · Read) and set
`CF_ANALYTICS_TOKEN`.

## The kill switch

```bash
npm run panic           # ~20s: the real Worker is replaced by maintenance.ts
npm run resume          # puts the app back (a normal build + deploy, ~2 min)
```

`npm run panic` deploys `maintenance.ts` with `wrangler.maintenance.jsonc`: same Worker name, same
domain, and **no bindings at all** — no R2, no D1, no rate limits, no assets, and the cron is off.
Visitors get a styled "paused" page, `/api/*` and `/feed.json` return 503 with
`Retry-After`, and robots are told to go away. Nothing can meter or spend while it is up.

Secrets live on the Worker, not in the config, so they survive both directions. Votes, listings and
payment rows are untouched — the data is in D1 and R2, which are simply not attached for a while.

### Order of things to try

1. `npm run usage` — is it real traffic or one address hammering us?
2. If it is abuse: Cloudflare dashboard → **Security → WAF** → block the IP or ASN. That leaves the
   app up for everyone else and costs nothing.
3. If it is one endpoint: tighten its `ratelimits` entry in `wrangler.jsonc` and deploy.
4. If it is still climbing or you don't yet know why: `npm run panic`.
5. Work out what happened (`npx wrangler tail`, R2 metrics), fix it, `npm run resume`.

## Add the hard edge: one WAF rate limiting rule (free plan includes it)

This is the only ceiling on Cloudflare that is actually enforced before our code runs. Ten minutes,
once:

1. dash.cloudflare.com → **outvids.lol → Security → WAF → Rate limiting rules → Create rule**.
2. Name: `api-abuse`. **If incoming requests match:** `URI Path` `starts with` `/api/`.
3. **With the same characteristics:** IP address. **When rate exceeds:** 120 requests per 1 minute.
4. **Then take action:** Block, duration 1 minute. Deploy.

Legitimate use is nowhere near 120 requests a minute to `/api/*`: a viewer swiping fast sends one
beacon and maybe one vote per reel.

## Guardrails in the code, and how well each one really works

**Measured, not assumed.** Against production, 40 sequential requests went through a
10-per-minute rate limiting **binding** without a single refusal — the binding is documented as
"permissive, eventually consistent, and intentionally designed to not be used as an accurate
accounting system", and it behaves that way. So `server/limit.ts` counts as well, in the isolate's
memory and in the edge cache. After that change, 16 rapid checkout attempts produced 5 refusals
(cap 10) — tighter, still not exact, because each isolate counts separately and cache writes take a
moment to be visible. Treat both as friction for sustained abuse, not as a hard cap. The WAF rule
above is the hard cap.

- **Per-IP ceilings**: 10 checkouts, 60 votes and 120 beacons per IP per minute — the binding
  (`ratelimits` in `wrangler.jsonc`) plus our own counter (`server/limit.ts`), whichever trips first.
  Both cost nothing and neither touches D1 or R2.
- **The swipe path is cache.** One `/feed.json` per phone (60s browser, 300s edge), videos immutable
  for a year, brand icons a day, the board 30s. A viral day mostly hits cache, not R2.
- **Nothing unauthenticated writes to R2.** Only the cron and a confirmed payment do.
- **`/api/rerank` and `/api/enrich` need `RERANK_TOKEN`**; the webhook needs a valid signature.
- **Brand enrichment is capped**: at most 4 icon downloads, 300 KB each, 64 KB of HTML, once per
  listing, off the request path.
- **Request bodies are capped** at 64 KB on the payment routes.
- **The free plan is itself a guardrail**: Workers requests and D1 queries past the daily allowance
  are refused, not billed. Vote or beacon abuse can exhaust a day's quota; it cannot create a bill.

## If we ever move to the paid Workers plan

The free plan's "stop, don't spend" behaviour goes away — requests past the included 10M/month start
billing. Before switching: set the billing alert first, re-read this page, and consider putting a
Cloudflare WAF rate-limiting rule in front of `/api/*` as well.
