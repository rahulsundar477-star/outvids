-- Outbid payments (Dodo Payments, merchant of record).
-- Money rules: amounts are integer cents; the board only counts bids in status 'paid';
-- every status change goes through a guarded UPDATE and leaves a row in bid_transitions.

CREATE TABLE bids (
  id                  TEXT    PRIMARY KEY,                 -- bid_<24 random hex>, unguessable
  idempotency_key     TEXT    NOT NULL UNIQUE,             -- from the client; a double-submit returns the same bid
  environment         TEXT    NOT NULL CHECK (environment IN ('test_mode', 'live_mode')),
  listing_key         TEXT    NOT NULL,                    -- normalized link: host+path, or x.com/<handle>
  link                TEXT    NOT NULL,                    -- canonical https URL shown on the board
  brand               TEXT    NOT NULL,
  category            TEXT    NOT NULL,
  prior_cents         INTEGER NOT NULL CHECK (prior_cents >= 0),          -- listing's paid total when checkout started
  target_cents        INTEGER NOT NULL CHECK (target_cents >= 1000),      -- listing total this bid asks for
  charge_cents        INTEGER NOT NULL CHECK (charge_cents >= 100),       -- pre-tax amount sent to Dodo = target - prior
  currency            TEXT    NOT NULL DEFAULT 'USD',
  status              TEXT    NOT NULL CHECK (status IN (
                        'created',      -- row written, checkout session not created yet
                        'pending',      -- checkout session live, waiting for Dodo
                        'paid',         -- verified succeeded payment: counts on the board
                        'failed', 'cancelled', 'expired',
                        'refunded', 'disputed', 'chargeback',
                        'review',       -- succeeded but something didn't match: held off the board for a human
                        'error'         -- Dodo refused to create the session
                      )),
  status_reason       TEXT,
  viewer_id           TEXT,
  ip_hash             TEXT,
  checkout_session_id TEXT    UNIQUE,
  checkout_url        TEXT,                                -- single-use Dodo URL, replayed on double-submit
  payment_id          TEXT    UNIQUE,
  paid_currency       TEXT,
  paid_total          INTEGER,                             -- what the buyer paid incl. tax, in paid_currency minor units
  paid_tax            INTEGER,
  settlement_amount   INTEGER,
  settlement_currency TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  paid_at             INTEGER,
  last_checked_at     INTEGER                              -- last server-side status check with Dodo
);
CREATE INDEX bids_board        ON bids (environment, status, listing_key);
CREATE INDEX bids_paid_at      ON bids (environment, status, paid_at);
CREATE INDEX bids_pending      ON bids (status, created_at);

-- Every webhook delivery, keyed by webhook-id (Dodo delivers at least once, so duplicates are expected).
CREATE TABLE payment_events (
  webhook_id   TEXT    PRIMARY KEY,
  type         TEXT    NOT NULL,
  payment_id   TEXT,
  bid_id       TEXT,
  outcome      TEXT    NOT NULL CHECK (outcome IN ('received', 'applied', 'ignored', 'error')),
  detail       TEXT,
  payload      TEXT    NOT NULL,                           -- raw signed body, for audit and disputes
  attempts     INTEGER NOT NULL DEFAULT 1,
  received_at  INTEGER NOT NULL,
  processed_at INTEGER
);
CREATE INDEX payment_events_payment ON payment_events (payment_id);

-- Append-only audit trail of bid status changes.
CREATE TABLE bid_transitions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  bid_id      TEXT    NOT NULL,
  from_status TEXT,
  to_status   TEXT    NOT NULL,
  source      TEXT    NOT NULL,                            -- checkout | webhook | status-check | reconcile
  ref         TEXT,                                        -- webhook id, payment id, or error
  at          INTEGER NOT NULL
);
CREATE INDEX bid_transitions_bid ON bid_transitions (bid_id);
