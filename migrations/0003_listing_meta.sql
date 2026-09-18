-- Brand details fetched once from a listing's own site (name, description, icon).
-- Filled after a payment is confirmed, never on the swipe path.
CREATE TABLE listing_meta (
  listing_key TEXT    PRIMARY KEY,
  name        TEXT,                        -- og:site_name / og:title / <title>, trimmed
  description TEXT,                        -- og:description / meta description, trimmed
  icon_key    TEXT,                        -- R2 key: brand-icons/<slug>.<ext>
  icon_type   TEXT,
  icon_bytes  INTEGER,
  source_url  TEXT    NOT NULL,            -- the URL actually fetched (after redirects)
  status      TEXT    NOT NULL CHECK (status IN ('ok', 'partial', 'failed')),
  error       TEXT,
  attempts    INTEGER NOT NULL DEFAULT 1,
  fetched_at  INTEGER NOT NULL
);
