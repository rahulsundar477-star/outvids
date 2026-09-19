# Outbid payments (Dodo Payments)

**Status (2026-09-17):** payments are live in **test mode**, and no real money moves.

- Board and pay sheet show a "Test mode" badge.
- Test-mode listings never sponsor the feed.

## How money flows

1. **Pay sheet.** The phone shows a quote. It's only a preview.
2. **`POST /api/checkout`.** This runs in `server/payments.ts` as plain Worker code, not Next.js.
   - It checks Origin, rate limits, and validates the link, category and amount.
   - It computes `prior` (the listing's paid total) and `charge = target − prior`.
   - It writes a `bids` row (`created`), then creates the Dodo checkout session with a Pay What You Want amount and `metadata.bid_id`.
   - The bid moves to `pending`, and the client is sent to Dodo's hosted checkout.
3. **Dodo checkout.** Dodo is the merchant of record: it calculates, collects and remits tax for the buyer's country.
4. **The bid only becomes `paid` from a verified source:**
   - **`POST /api/webhooks/dodo`:** Standard Webhooks signature → dedupe by `webhook-id` → **re-read the payment from the Dodo API** → match session, product, currency and pre-tax amount.
   - **`GET /api/checkout/status`** (the return page polls it) asks Dodo directly, at most every 8s per bid.
   - **The hourly cron** (`reconcilePayments`) settles missed webhooks and expires checkouts left pending for 26h.
5. **Anything that doesn't match → `review`,** held off the board for a human. Refunds go to `refunded`, disputes to `disputed` (then `paid` if won, `chargeback` if lost).
6. **The board** (`GET /api/board`) sums `charge_cents` of `paid` bids for the current environment. It's edge-cached for 30s and purged on every change.

Every status change is a guarded UPDATE plus a `bid_transitions` audit row in one D1 batch. Raw signed webhook bodies are kept in `payment_events`.

## Brand details (name, description, icon)

When a payment is confirmed, the Worker fetches the listing's own site **once** and stores its name,
description and icon (`server/enrich.ts`, table `listing_meta`, icons in R2 under `brand-icons/`).

- Runs after the response, never on the swipe path and never while a buyer waits.
- Budgets: 64 KB of HTML, 300 KB per icon and at most 4 icon downloads, 8s/5s timeouts, regex parsing (no DOM).
- **Icon quality.** Candidates come from the `<link rel=icon>` tags, the web app manifest (usually where the
  192 and 512px icons are), `/apple-touch-icon.png` and `/favicon.ico`. Each download's real pixel size is read
  from its own file header (`imageSize()` — no decoding), and the first one at 128px or better wins; otherwise
  the biggest of the four does. SVG counts as unbeatable. The size is stored in `listing_meta.icon_w/icon_h`,
  and the board insets anything under 96px rather than stretching it.
- **Sites that block us** (403 is common) still get a logo: the favicon service is always tried when nothing
  else reached 128px, including when the page fetch itself failed. That row is `partial` — icon, no text.
- The icon is served by us at `/api/icon/<listing_key>?v=<fetched_at>` (cached a day, version changes on refetch),
  so visitors never hit the brand's server.
- If the site is slow, blocked or down, the payment is unaffected: the row records `failed` (or `partial` when
  only the icon came through), the board shows the listing with what it has, and the hourly cron retries a
  `failed` row up to 3 times.
- Refresh by hand: `POST /api/enrich {"link": "https://brand.com"}` with `Authorization: Bearer <RERANK_TOKEN>`.
  Add `raw` in the response to see exactly what was parsed.

Measured on 5 live sites from outbid.lol: **4-9ms CPU** each, 1-5s wall time (waiting on their servers, which
costs nothing). A later run over 16 sites (outbid.lol's own board) returned 512x512 icons for BotSeen, RankControl
and Tutti, 192x192 for Outrank and inetGeek, and the service fallback at 256x256 for the sites that blocked us.

## Config

| Name                        | Where                | Value                                                                                                |
| --------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------- |
| `DODO_PAYMENTS_API_KEY`     | wrangler secret      | test key                                                                                             |
| `DODO_PAYMENTS_WEBHOOK_KEY` | wrangler secret      | signing secret of endpoint `ep_3JSiQDJMhPWETF3ZlT0V2bv82M6`                                          |
| `DODO_ENVIRONMENT`          | `wrangler.jsonc` var | `test_mode`                                                                                          |
| `DODO_BID_PRODUCT_ID`       | var                  | `pdt_0Nno7geQl7XrtnPp4p8VS` ("Outbid listing", Pay What You Want, $1 minimum, tax exclusive, no PPP) |
| `DODO_BUSINESS_ID`          | var                  | `bus_zZcJA2RqYtLEnVoHEj5N8` (events from other businesses are ignored)                               |
| `CHECKOUT_RL`               | ratelimit binding    | 10 checkouts per IP per minute                                                                       |

Payments switch off automatically if the key, webhook key or product id is missing: checkout returns 503 and says "nothing was charged".

## Test it

- **Unit and integration:** `npm run test:payments` runs 25 scenarios against real SQLite with the migrations, real signature verification, and mocked Dodo network calls.
- **Real test-mode payment:** open outvids.lol → Outbid → add a link → Continue to secure checkout.
  - Pay with a Dodo test card (see Dodo's testing docs).
  - The return page should go from "Confirming" to "You're #N", and the listing appears on the board with the Test mode badge.
  - Check D1:
    ```sql
    SELECT id, status, charge_cents, paid_total, paid_tax FROM bids ORDER BY created_at DESC LIMIT 5;
    SELECT webhook_id, type, outcome, detail FROM payment_events ORDER BY received_at DESC LIMIT 5;
    ```

## Testing (open to anyone, right now)

Test mode is deliberately open: anyone can put a listing on the board with a Dodo test card, and the board and pay sheet both say "Test mode".

- Card `4242 4242 4242 4242`, expiry `06/32`, CVV `123` (shown in the pay sheet).
- Declined card: `4000 0000 0000 0002`. UPI: `success@upi` / `failure@upi` (billing country IN, INR).
- Test listings never sponsor the feed; only live-mode payments do that.

Check what exists at any time:

```bash
npm run golive:check
```

## Going live (once the Dodo account is approved)

1. **Create the live product and webhook**, and store the live webhook secret:
   ```bash
   DODO_ENVIRONMENT=live_mode DODO_PAYMENTS_API_KEY=<live key> node scripts-dodo-setup.mjs
   ```
2. **Store the live API key:** `npx wrangler secret put DODO_PAYMENTS_API_KEY`
3. **Edit `wrangler.jsonc`:** `DODO_ENVIRONMENT` to `live_mode`, plus the live `DODO_BID_PRODUCT_ID` and `DODO_BUSINESS_ID` the script printed.
4. **Deploy:** `npm run deploy`, then read the bindings list.
5. **Wipe every test listing, payment and audit row** (writes a JSON backup to `backups/` first, and only ever touches `environment = 'test_mode'`):
   ```bash
   npm run golive:clean-test          # dry run: shows what goes
   npm run golive:clean-test -- --yes # back up, then delete
   ```
6. **Confirm:** `npm run golive:check` shows mode `live_mode` and no test rows, and `/api/board` is empty.
7. **Make one small real payment,** then refund it from the Dodo dashboard and confirm the listing leaves the board.

Even before step 5, a live-mode board never shows test listings — the board filters by environment. The clean-up is for a genuinely empty start.
