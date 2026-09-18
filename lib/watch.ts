/**
 * Watch accounting for the reel on screen. Listens locally (play/pause/timeupdate) but reports once:
 * one beacon when the viewer leaves the clip — swipe, tab switch, app hidden, or page unload.
 */
import type { FeedClip } from "./feed";

export type LeaveReason = "swipe" | "hidden" | "tab" | "unload";
export type WatchResult = { clip: FeedClip; watchedMs: number; furthestMs: number; loops: number; finished: boolean };

type Session = { clip: FeedClip; watched: number; since: number | null; furthest: number; last: number; loops: number };

export class WatchTracker {
  private s: Session | null = null;

  constructor(private readonly viewer: () => string, private readonly onLeave: (r: WatchResult) => void) {}

  get clipId() {
    return this.s?.clip.id ?? null;
  }

  start(clip: FeedClip) {
    this.s = { clip, watched: 0, since: null, furthest: 0, last: 0, loops: 0 };
  }

  playing(clipId: string) {
    if (this.s?.clip.id === clipId && this.s.since === null) this.s.since = performance.now();
  }

  paused(clipId: string) {
    const s = this.s;
    if (s?.clip.id !== clipId || s.since === null) return;
    s.watched += performance.now() - s.since;
    s.since = null;
  }

  time(clipId: string, seconds: number) {
    const s = this.s;
    if (s?.clip.id !== clipId) return;
    if (seconds + 0.5 < s.last) s.loops++; // `loop` never fires "ended": a jump back to the start is a loop
    s.last = seconds;
    s.furthest = Math.max(s.furthest, seconds * 1000);
  }

  flush(reason: LeaveReason) {
    const s = this.s;
    this.s = null;
    if (!s) return;
    if (s.since !== null) s.watched += performance.now() - s.since;
    if (s.watched < 250) return; // never actually played

    const durationMs = s.clip.duration * 1000;
    const finished = s.loops > 0 || s.furthest >= 0.9 * durationMs;
    this.onLeave({ clip: s.clip, watchedMs: s.watched, furthestMs: s.furthest, loops: s.loops, finished });

    const body = JSON.stringify({
      c: s.clip.id,
      v: this.viewer(),
      w: Math.round(s.watched),
      d: Math.round(durationMs),
      p: Math.round(Math.min(s.furthest, durationMs)),
      l: s.loops,
      r: reason,
    });
    try {
      if (!navigator.sendBeacon?.("/api/beacon", body)) {
        fetch("/api/beacon", { method: "POST", body, keepalive: true }).catch(() => {});
      }
    } catch {}
  }
}
