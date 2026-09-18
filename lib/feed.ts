/** Shape of /feed.json — shared by the re-rank job (writer) and the player (reader). No server imports here. */

export type FeedClip = {
  id: string; // file stem, e.g. pod_A2b
  url: string; // /api/stream/<id>
  track: string;
  setting: string;
  people: string;
  frame: string;
  engine: string | null;
  duration: number;
  /** Public count: unique Outvids from the votes table at generation time. */
  votes: number;
  /** Plays counted from beacons (0 until Analytics Engine is wired). */
  views: number;
  /** Internal ranking score: completion + skip + vote rate + explore. */
  score: number;
  /** 1 = held out of every viewer's first 100 reels (weak formats, e.g. older-cast interview Q&A). */
  hold?: 0 | 1;
  /** Relative pick weight for the client shuffle, (0, 1]. */
  weight: number;
};

export type Feed = {
  v: 1;
  generated_at: string;
  trigger: "cron" | "upload" | "manual" | "bootstrap";
  /** "analytics+votes" when beacon stats were read, "votes" when only the votes table was. */
  source: "analytics+votes" | "votes";
  count: number;
  clips: FeedClip[];
};

export const isValidClipId = (id: string) => /^[A-Za-z0-9][A-Za-z0-9_.-]{0,200}$/.test(id) && !id.includes("..");
export const isValidViewerId = (id: string) => /^[a-z0-9]{8,40}$/.test(id);
