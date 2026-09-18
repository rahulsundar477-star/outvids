# Outvids data map

Four stores. Only one of them (R2 `feed.json`) sits on the swipe path.

## R2 bucket `clips` (binding `CLIPS`)

- `manifest.json`: the catalog, written by `platform/upload_r2.py`. The feed only uses rows with `canonical = 1` (256 of 280).
  Fields: `clip_id, r2_key, track (main|rc|pod|balanced), duration, bytes, canonical, dup_of, dup_confidence, engine, logline, tag_people, tag_age, tag_frame, tag_speech, tag_turn, tag_setting, tag_object_focus, label_ts`
- `videos/<clip_id with / → _>.mp4`: h264+aac faststart. Immutable, cached for a year.
  - The public id is the file stem (`pod_A2b`), served at `/api/stream/<id>`.
- `feed.json`: the ranked list, written **only** by `lib/rank.ts`. Its shape is `Feed` in `lib/feed.ts`:
  `{ v, generated_at, trigger (cron|upload|manual|bootstrap), source (votes|analytics+votes), count, clips[] }`
  - Each clip has `id, url, track, setting, people, frame, engine, duration, votes, views, score, weight`.

## D1 `outvids` (binding `DB`, migrations in `migrations/`)

```sql
votes       (clip_id, voter_id, created_at)  PK (clip_id, voter_id)  -- one Outvid per viewer per clip
clip_scores (clip_id PK, views, completions, skips, votes, completion, skip, vote_rate, explore, score, updated_at)
rank_runs   (id PK, ran_at, trigger, source, clips, ms)
-- payments (migrations/0002_payments.sql, see docs/payments.md)
bids            (id PK 'bid_<hex>', idempotency_key UNIQUE, environment, listing_key, link, brand, category,
                 prior_cents, target_cents, charge_cents, currency, status, status_reason, viewer_id, ip_hash,
                 checkout_session_id UNIQUE, checkout_url, payment_id UNIQUE, paid_currency, paid_total, paid_tax,
                 settlement_amount, settlement_currency, created_at, updated_at, paid_at, last_checked_at)
payment_events  (webhook_id PK, type, payment_id, bid_id, outcome received|applied|ignored|error, detail, payload, attempts, received_at, processed_at)
bid_transitions (id PK, bid_id, from_status, to_status, source checkout|webhook|status-check|reconcile, ref, at)  -- append-only audit
listing_meta    (listing_key PK, name, description, icon_key, icon_type, icon_bytes, source_url, status ok|partial|failed, error, attempts, fetched_at)  -- fetched from the brand's own site
```

- Bid status: `created → pending → paid | failed | cancelled | expired | error`. After paid: `refunded | disputed → paid | chargeback`. `review` = succeeded but mismatched, held off the board.
- The board is `SUM(charge_cents)` of `paid` bids per `listing_key` for the current environment, ties broken by the oldest `first paid_at`.

- `voter_id` is the per-device viewer id from localStorage (`lib/device.ts`), not an account.
- Read it via the `db` MCP (`execute_sql_outvids_d1`), which works on a **snapshot**. Refresh it first with `npm run db:snapshot`.

## Analytics Engine `outvids_beacons` (binding `BEACONS`, not enabled yet)

One data point per clip leave, written by `/api/beacon`:

- `index1` / `blob1` = clip, `blob2` = viewer, `blob3` = reason (swipe|hidden|tab|unload)
- `double1` watched_ms, `double2` duration_ms, `double3` completion ratio, `double4` completed (0/1), `double5` skipped (0/1), `double6` loops

## Device (localStorage key `ov-device-v1`)

`{ viewer, voted{id:{at,views}}, seen{id:ts}, days[], finished, taste{tag:n} }`

- The streak, the "You" stats and the session no-repeat all come from here. Nothing about them is server-side.
