/** Server-only: the R2 catalog (manifest.json written by platform/upload_r2.py). */

export type ManifestRow = {
  clip_id: string;
  r2_key: string;
  track: string;
  duration: number;
  bytes: number;
  canonical: number;
  dup_of: string | null;
  dup_confidence: number | null;
  engine: string | null;
  logline: string;
  tag_people: string;
  tag_age: string;
  tag_frame: string;
  tag_speech: string;
  tag_turn: string;
  tag_setting: string;
  tag_object_focus: string;
  label_ts: string;
};

export const MANIFEST_KEY = "manifest.json";
export const FEED_KEY = "feed.json";
/** Ids that have a poster in R2, written by scripts-posters.mjs. One read per re-rank, no bucket listing. */
export const POSTER_INDEX_KEY = "posters/index.json";
export const posterKeyFromId = (id: string) => `posters/${id}.webp`;

/** Public id is the object's file stem: videos/pod_A2b.mp4 → pod_A2b. */
export const idFromKey = (key: string) => key.replace(/^videos\//, "").replace(/\.mp4$/, "");
export const keyFromId = (id: string) => `videos/${id}.mp4`;

const MANIFEST_TTL_MS = 60_000;
let cached: { at: number; rows: ManifestRow[] } | null = null;

/** Canonical rows only — duplicates stay staged in R2 but never reach the feed. */
export async function loadManifest(bucket: R2Bucket, fresh = false): Promise<ManifestRow[]> {
  if (!fresh && cached && Date.now() - cached.at < MANIFEST_TTL_MS) return cached.rows;
  const obj = await bucket.get(MANIFEST_KEY);
  if (!obj) throw new Error(`${MANIFEST_KEY} not found in R2 bucket`);
  const rows = ((await obj.json()) as ManifestRow[]).filter((r) => r.canonical === 1);
  cached = { at: Date.now(), rows };
  return rows;
}
