-- One row per (clip, viewer): an Outvid can only be given once. The public vote count is COUNT(*).
CREATE TABLE votes (
  clip_id    TEXT    NOT NULL,
  voter_id   TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (clip_id, voter_id)
) WITHOUT ROWID;
CREATE INDEX votes_voter ON votes (voter_id);

-- Latest ranking inputs/outputs per clip, written by the re-rank job (inspection + debugging; feed.json is what serves).
CREATE TABLE clip_scores (
  clip_id     TEXT PRIMARY KEY,
  views       REAL    NOT NULL,
  completions REAL    NOT NULL,
  skips       REAL    NOT NULL,
  votes       INTEGER NOT NULL,
  completion  REAL    NOT NULL,
  skip        REAL    NOT NULL,
  vote_rate   REAL    NOT NULL,
  explore     REAL    NOT NULL,
  score       REAL    NOT NULL,
  updated_at  INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE rank_runs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ran_at     INTEGER NOT NULL,
  trigger    TEXT    NOT NULL,
  source     TEXT    NOT NULL,
  clips      INTEGER NOT NULL,
  ms         INTEGER NOT NULL
);
