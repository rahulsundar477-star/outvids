/**
 * The re-rank job. Owned by the cron (hourly) and re-run after an upload — never by the player.
 *
 *   inputs:  manifest.json (catalog) · votes table (unique Outvids) · Analytics Engine beacons (last 30 days)
 *   output:  feed.json in R2 (the one ranked list every phone downloads) + clip_scores snapshot in D1
 *
 * Score per clip, all rates Bayesian-smoothed toward the catalog average so a clip with 3 views
 * can't outrank one with 3,000 on luck:
 *   quality = 0.50·completion + 0.25·(1 − skip) + 0.25·voteScore
 *   explore = min(0.25, 0.12·√(ln(N + e) / (views + 1)))       — UCB-style, fades as a clip gets watched
 *   score   = quality + explore
 */
import { FEED_KEY, idFromKey, loadManifest, type ManifestRow } from "./clips";
import type { Feed, FeedClip } from "./feed";

export type RankEnv = {
  CLIPS: R2Bucket;
  DB: D1Database;
  OUTVIDS_ACCOUNT_ID?: string;
  CF_ANALYTICS_TOKEN?: string;
};

type Stat = { views: number; completions: number; skips: number };

const DATASET = "outvids_beacons";
const PRIOR_VIEWS = 20; // pseudo-views pulling each rate toward the catalog mean
const WEIGHTS = { completion: 0.5, noSkip: 0.25, vote: 0.25 };
const EXPLORE = { k: 0.12, cap: 0.25 };
const WEIGHT_TEMPERATURE = 0.12; // client pick weight = exp((score − best) / T)

async function voteCounts(db: D1Database): Promise<Map<string, number>> {
  const { results } = await db.prepare("SELECT clip_id, COUNT(*) AS n FROM votes GROUP BY clip_id").all<{ clip_id: string; n: number }>();
  return new Map(results.map((r) => [r.clip_id, Number(r.n)]));
}

/** Per-clip beacon aggregates from the Analytics Engine SQL API. Null when the API token isn't configured. */
async function beaconStats(env: RankEnv): Promise<Map<string, Stat> | null> {
  if (!env.OUTVIDS_ACCOUNT_ID || !env.CF_ANALYTICS_TOKEN) return null;
  const sql = `
    SELECT blob1 AS clip_id,
           SUM(_sample_interval) AS views,
           SUM(_sample_interval * double4) AS completions,
           SUM(_sample_interval * double5) AS skips
    FROM ${DATASET}
    WHERE timestamp > NOW() - INTERVAL '30' DAY
    GROUP BY clip_id
    FORMAT JSON`;
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.OUTVIDS_ACCOUNT_ID}/analytics_engine/sql`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}` },
    body: sql,
  });
  if (!res.ok) throw new Error(`Analytics Engine SQL ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { data: { clip_id: string; views: string | number; completions: string | number; skips: string | number }[] };
  return new Map(
    body.data.map((r) => [r.clip_id, { views: Number(r.views) || 0, completions: Number(r.completions) || 0, skips: Number(r.skips) || 0 }]),
  );
}

export function scoreClips(rows: ManifestRow[], votes: Map<string, number>, stats: Map<string, Stat> | null) {
  const stat = (id: string): Stat => stats?.get(id) ?? { views: 0, completions: 0, skips: 0 };

  let V = 0, C = 0, S = 0, U = 0;
  for (const r of rows) {
    const id = idFromKey(r.r2_key);
    const s = stat(id);
    V += s.views; C += s.completions; S += s.skips; U += votes.get(id) ?? 0;
  }
  // Catalog means, with a weak default before any data exists.
  const meanCompletion = (C + 1) / (V + 2);
  const meanSkip = (S + 1) / (V + 3);
  const meanVoteRate = (U + 1) / (V + 50);
  const logN = Math.log(V + Math.E);

  return rows.map((r) => {
    const id = idFromKey(r.r2_key);
    const s = stat(id);
    const u = votes.get(id) ?? 0;
    const completion = (s.completions + PRIOR_VIEWS * meanCompletion) / (s.views + PRIOR_VIEWS);
    const skip = (s.skips + PRIOR_VIEWS * meanSkip) / (s.views + PRIOR_VIEWS);
    const voteRate = (u + PRIOR_VIEWS * meanVoteRate) / (s.views + PRIOR_VIEWS);
    const voteScore = voteRate / (voteRate + meanVoteRate); // 0.5 at the catalog average
    const explore = Math.min(EXPLORE.cap, EXPLORE.k * Math.sqrt(logN / (s.views + 1)));
    const score = WEIGHTS.completion * completion + WEIGHTS.noSkip * (1 - skip) + WEIGHTS.vote * voteScore + explore;
    return { row: r, id, stat: s, votes: u, completion, skip, voteRate, explore, score };
  });
}

export async function rerank(env: RankEnv, trigger: Feed["trigger"]) {
  const started = Date.now();
  const [rows, votes] = await Promise.all([loadManifest(env.CLIPS, true), voteCounts(env.DB)]);

  let stats: Map<string, Stat> | null = null;
  let statsError: string | null = null;
  try {
    stats = await beaconStats(env);
  } catch (err) {
    statsError = String(err); // rank on votes + explore rather than serve a stale feed
  }

  const scored = scoreClips(rows, votes, stats).sort((a, b) => b.score - a.score);
  const best = scored[0]?.score ?? 0;

  const clips: FeedClip[] = scored.map((c) => ({
    id: c.id,
    url: `/api/stream/${c.id}`,
    track: c.row.track,
    setting: c.row.tag_setting,
    people: c.row.tag_people,
    frame: c.row.tag_frame,
    engine: c.row.engine,
    duration: c.row.duration,
    votes: c.votes,
    views: Math.round(c.stat.views),
    score: round(c.score),
    weight: round(Math.max(0.02, Math.exp((c.score - best) / WEIGHT_TEMPERATURE))),
  }));

  const feed: Feed = {
    v: 1,
    generated_at: new Date().toISOString(),
    trigger,
    source: stats ? "analytics+votes" : "votes",
    count: clips.length,
    clips,
  };

  await env.CLIPS.put(FEED_KEY, JSON.stringify(feed), {
    httpMetadata: { contentType: "application/json", cacheControl: "public, max-age=60, s-maxage=300" },
  });

  const now = Date.now();
  const upsert = env.DB.prepare(
    `INSERT INTO clip_scores (clip_id, views, completions, skips, votes, completion, skip, vote_rate, explore, score, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
     ON CONFLICT (clip_id) DO UPDATE SET views = ?2, completions = ?3, skips = ?4, votes = ?5,
       completion = ?6, skip = ?7, vote_rate = ?8, explore = ?9, score = ?10, updated_at = ?11`,
  );
  await env.DB.batch([
    ...scored.map((c) =>
      upsert.bind(c.id, c.stat.views, c.stat.completions, c.stat.skips, c.votes, c.completion, c.skip, c.voteRate, c.explore, c.score, now),
    ),
    env.DB.prepare("INSERT INTO rank_runs (ran_at, trigger, source, clips, ms) VALUES (?, ?, ?, ?, ?)").bind(
      now, trigger, feed.source, clips.length, now - started,
    ),
  ]);

  return { feed, statsError, ms: Date.now() - started };
}

const round = (n: number) => Math.round(n * 10000) / 10000;
