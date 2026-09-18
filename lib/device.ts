/**
 * Everything the player remembers about this viewer, on this device only (no accounts yet).
 * Starts at zero. localStorage can be missing or throw (private mode) — then it just doesn't persist.
 */
import type { FeedClip } from "./feed";

export type DeviceState = {
  viewer: string;
  /** Clips this device gave an Outvid to, with the play count at that moment (for "spotted early"). */
  voted: Record<string, { at: number; views: number }>;
  /** Last time each clip was left after being watched (session no-repeat). */
  seen: Record<string, number>;
  /** Local calendar days (YYYY-MM-DD) with at least one finished reel — the streak. */
  days: string[];
  /** Finished reels, total and by tag. */
  finished: number;
  taste: Record<string, number>;
  /** When the first-run intro card was dismissed (shown once per device). */
  intro?: number;
};

const KEY = "ov-device-v1";
const SEEN_WINDOW_MS = 24 * 60 * 60 * 1000;

const newViewer = () => {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => (b % 36).toString(36)).join("");
};

export const emptyDevice = (): DeviceState => ({ viewer: "", voted: {}, seen: {}, days: [], finished: 0, taste: {} });

export function loadDevice(): DeviceState {
  let state = emptyDevice();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state = { ...state, ...JSON.parse(raw) };
  } catch {}
  if (!/^[a-z0-9]{8,40}$/.test(state.viewer)) state.viewer = newViewer();
  // Drop stale "seen" marks so tomorrow's feed can show them again.
  const cutoff = Date.now() - SEEN_WINDOW_MS;
  state.seen = Object.fromEntries(Object.entries(state.seen).filter(([, t]) => t > cutoff));
  saveDevice(state);
  return state;
}

export function saveDevice(state: DeviceState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {}
}

export function clearDevice() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}

export const localDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Consecutive days with a finished reel, counting back from today (or from yesterday if today isn't done yet). */
export function streakOf(days: string[]) {
  const set = new Set(days);
  const d = new Date();
  if (!set.has(localDay(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (set.has(localDay(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

/** Monday-first current week: which days have a finished reel, and which one is today. */
export function weekOf(days: string[]) {
  const set = new Set(days);
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  return ["M", "T", "W", "T", "F", "S", "S"].map((label, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const key = localDay(d);
    return { label, done: set.has(key), today: key === localDay(today) };
  });
}

/** Tag keys counted per finished reel. */
export const tasteKeys = (c: FeedClip) => [`setting:${c.setting}`, `people:${c.people}`, `frame:${c.frame}`];

const TASTE_LABELS: Record<string, string> = {
  "setting:work": "Workplace scenes",
  "setting:public": "Out in public",
  "setting:home": "At-home moments",
  "setting:outdoor": "Outdoor shots",
  "setting:stage": "On-stage bits",
  "people:solo": "One person on screen",
  "people:duo": "Two-handers",
  "people:group": "Group scenes",
  "people:none": "No people at all",
  "frame:closeup": "Close-ups",
  "frame:medium": "Medium shots",
  "frame:wide": "Wide shots",
};

/** Top three tags among finished reels, as a share of finished reels. */
export function tasteOf(state: DeviceState) {
  if (state.finished < 3) return [];
  return Object.entries(state.taste)
    .filter(([k]) => TASTE_LABELS[k])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, n]) => ({ key: k, label: TASTE_LABELS[k], share: Math.round((100 * n) / state.finished) }));
}

export const nextMilestone = (streak: number) => [3, 7, 15, 30, 60, 100, 365].find((m) => m > streak) ?? streak + 100;
