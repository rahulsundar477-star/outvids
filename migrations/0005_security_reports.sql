-- Vulnerability reports from outvids.lol/security (linked from /.well-known/security.txt).
-- Written only by server/security.ts: same-origin, rate limited, size-capped. Read with
-- `npm run security:reports`. The reporter's IP is never stored, only a salted hash.
CREATE TABLE security_reports (
  id          TEXT    PRIMARY KEY,                -- sr_<16 random hex>
  summary     TEXT    NOT NULL,
  details     TEXT    NOT NULL,
  url         TEXT,                               -- affected page or endpoint, if given
  contact     TEXT,                               -- how to reply, if the reporter wants one
  ip_hash     TEXT,
  user_agent  TEXT,
  status      TEXT    NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'triaged', 'fixed', 'invalid')),
  created_at  INTEGER NOT NULL
);
CREATE INDEX security_reports_created ON security_reports (created_at);
