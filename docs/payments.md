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

- **Unit and integration:** `npm run test:payments` runs 19 scenarios against real SQLite with the migrations, real signature verification, and mocked Dodo network calls.
- **Real test-mode payment:** open outvids.lol → Outbid → add a link → Continue to secure checkout.
  - Pay with a Dodo test card (see Dodo's testing docs).
  - The return page should go from "Confirming" to "You're #N", and the listing appears on the board with the Test mode badge.
  - Check D1:
    ```sql
    SELECT id, status, charge_cents, paid_total, paid_tax FROM bids ORDER BY created_at DESC LIMIT 5;
    SELECT webhook_id, type, outcome, detail FROM payment_events ORDER BY received_at DESC LIMIT 5;
    ```

## Going live (once the Dodo account is approved)

1. In **live** mode, run `DODO_ENVIRONMENT=live_mode DODO_PAYMENTS_API_KEY=<live key> node scripts-dodo-setup.mjs`. It creates the live product and webhook, and stores the live webhook secret.
2. Store the live key: `npx wrangler secret put DODO_PAYMENTS_API_KEY`.
3. In `wrangler.jsonc`:
   - set `DODO_ENVIRONMENT` to `live_mode`;
   - set `DODO_BID_PRODUCT_ID` to the live product id the script printed;
   - set `DODO_BUSINESS_ID` to the live business id.
4. `npm run deploy`, then read the bindings list.
5. Make one small real payment, then confirm the refund flow from the Dodo dashboard. The listing should drop off the board.

Test-mode bids stay in D1 but never show on the live board, because the board filters by environment.
