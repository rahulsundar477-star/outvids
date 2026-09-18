"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { FeedClip } from "@/lib/feed";
import { short, usd } from "@/lib/data";
import type { BoardEntry } from "@/lib/listing";
import { promoSlots } from "@/lib/promo";
import { WatchTracker, type WatchResult } from "@/lib/watch";
import PromoSlide from "./PromoSlide";
import { FlameIcon, PlayIcon, ShareIcon, SpeakerIcon } from "./icons";
import FlameBurst from "./FlameBurst";
import { heading, tabular } from "./styles";

type Props = {
  clips: FeedClip[];
  status: "loading" | "ready" | "error";
  onRetry: () => void;
  viewer: string;
  startIndex: number;
  onActive: (index: number) => void;
  onLeave: (r: WatchResult) => void;
  isVoted: (id: string) => boolean;
  countOf: (clip: FeedClip) => number;
  onVote: (clip: FeedClip, onlyOn?: boolean) => void;
  onShare: (clip: FeedClip) => void;
  muted: boolean;
  setMuted: (m: boolean) => void;
  streak: number;
  /** #1 on the all-time Outbid board, or null while the slot is open. */
  leader: BoardEntry | null;
  /** Seeds where the Outbid slide lands in the feed (stable per viewer per day). */
  promoSeed: string;
  reels: number;
  goBoard: () => void;
  goStreak: () => void;
};

const WINDOW_BEHIND = 1;
const WINDOW_AHEAD = 2;
const DOUBLE_TAP_MS = 280;

export default function FeedScreen(p: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(p.startIndex);
  const [rendered, setRendered] = useState(p.startIndex + 6);
  const [paused, setPaused] = useState(false);
  const [burst, setBurst] = useState<{ id: string; n: number; x: number; y: number } | null>(null);
  const burstT = useRef<ReturnType<typeof setTimeout>>(undefined);
  const videos = useRef(new Map<string, HTMLVideoElement>());

  // Latest props for the long-lived tracker/listeners.
  const latest = useRef(p);
  latest.current = p;
  const tracker = useRef<WatchTracker | null>(null);
  if (!tracker.current) tracker.current = new WatchTracker(() => latest.current.viewer, (r) => latest.current.onLeave(r));

  // Clips plus the Outbid slide at seeded positions. Built once per feed, not per render.
  type Item = { kind: "clip"; clip: FeedClip } | { kind: "promo"; id: string };
  const items = useMemo<Item[]>(() => {
    const slots = promoSlots(p.promoSeed, p.clips.length);
    const out: Item[] = [];
    p.clips.forEach((clip, i) => {
      if (slots.has(i)) out.push({ kind: "promo", id: `promo-${i}` });
      out.push({ kind: "clip", clip });
    });
    return out;
  }, [p.clips, p.promoSeed]);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Restore the reel you were on when coming back from another tab.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && p.startIndex > 0) el.scrollTop = p.startIndex * el.clientHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.clips.length > 0]);

  // Active item changed: close the previous watch session (one beacon), open the next.
  // A promo slide is not a clip: it only ends the previous session.
  const activeItem = items[active];
  const activeClip = activeItem?.kind === "clip" ? activeItem.clip : null;
  useEffect(() => {
    if (!activeItem) return;
    const t = tracker.current!;
    t.flush("swipe");
    if (activeClip) {
      t.start(activeClip);
      const v = videos.current.get(activeClip.id);
      if (v && !v.paused) t.playing(activeClip.id);
    }
    setPaused(false);
    latest.current.onActive(active);
    setRendered((r) => (active >= r - 3 ? Math.min(itemsRef.current.length, r + 8) : r));
  }, [activeItem, activeClip, active]);

  // Leaving the app or the page also ends the session.
  useEffect(() => {
    const t = tracker.current!;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        t.flush("hidden");
      } else {
        const item = itemsRef.current[activeRef.current];
        if (item?.kind !== "clip") return;
        t.start(item.clip);
        const v = videos.current.get(item.clip.id);
        if (v && !v.paused) t.playing(item.clip.id);
      }
    };
    const onPageHide = () => t.flush("unload");
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      t.flush("tab");
      clearTimeout(burstT.current);
    };
  }, []);
  const activeRef = useRef(active);
  activeRef.current = active;

  function onScroll() {
    const el = scroller.current;
    if (!el || !el.clientHeight) return;
    const i = Math.max(0, Math.min(itemsRef.current.length - 1, Math.round(el.scrollTop / el.clientHeight)));
    if (i !== activeRef.current) setActive(i);
  }

  // Tap = pause/play, double-tap = Outvid with a flame burst. Our own detection: dblclick is unreliable on iOS.
  const tap = useRef<{ t: number; x: number; y: number; timer?: ReturnType<typeof setTimeout>; downX: number; downY: number }>({ t: 0, x: 0, y: 0, downX: 0, downY: 0 });
  function onPointerDown(e: ReactPointerEvent) {
    tap.current.downX = e.clientX;
    tap.current.downY = e.clientY;
  }
  function onPointerUp(clip: FeedClip, e: ReactPointerEvent<HTMLElement>) {
    if ((e.target as Element).closest("button, a")) return;
    const s = tap.current;
    if (Math.abs(e.clientX - s.downX) > 10 || Math.abs(e.clientY - s.downY) > 10) return; // a swipe, not a tap
    const now = performance.now();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (now - s.t < DOUBLE_TAP_MS && Math.hypot(x - s.x, y - s.y) < 40) {
      clearTimeout(s.timer);
      s.t = 0;
      p.onVote(clip, true);
      setBurst((b) => ({ id: clip.id, n: (b?.n ?? 0) + 1, x, y }));
      clearTimeout(burstT.current);
      burstT.current = setTimeout(() => setBurst(null), 700);
      return;
    }
    s.t = now;
    s.x = x;
    s.y = y;
    clearTimeout(s.timer);
    s.timer = setTimeout(() => setPaused((v) => !v), DOUBLE_TAP_MS);
  }

  const showNote = p.clips.length === 0;

  return (
    <>
      <div className="ov-topbar">
        <h1 style={{ ...heading(16, 700), margin: 0, letterSpacing: "-.01em", textShadow: "0 1px 8px rgba(11,10,10,.8)", pointerEvents: "none" }}>
          OUTVIDS<span aria-hidden="true" style={{ color: "var(--color-accent)", marginLeft: 1 }}>$</span>
        </h1>
        <span style={{ flex: 1 }} />
        <button
          onClick={p.goBoard}
          className="ov-pill hov-edge"
          aria-label={p.leader ? `${p.leader.brand} holds #1 at ${usd(p.leader.total_cents / 100)} — open Outbid` : "The sponsor spot is open — open Outbid"}
          style={{ paddingLeft: 6, maxWidth: "58%" }}
        >
          <span style={{
            flex: "none", width: 22, height: 22, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center",
            border: p.leader ? "1px solid rgba(255,77,28,.4)" : "1px dashed rgba(245,241,234,.28)",
            background: p.leader ? "rgba(255,77,28,.14)" : "transparent", color: "var(--color-accent-300)", fontSize: p.leader ? 10.5 : 13, lineHeight: 1, fontWeight: 700,
          }}>{p.leader ? "#1" : "+"}</span>
          <span style={{ ...heading(12.5), letterSpacing: "-.01em", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{p.leader ? p.leader.brand : "Claim #1"}</span>
          <span style={{ flex: "none", width: 1, height: 13, background: "rgba(245,241,234,.14)" }} />
          <span style={{ flex: "none", ...heading(12.5), color: "var(--color-accent-300)", ...tabular }}>{p.leader ? usd(p.leader.total_cents / 100) : "$10"}</span>
        </button>
        <button onClick={p.goStreak} className="ov-pill hov-edge" aria-label={`${p.streak} day streak — open your streak`}>
          <FlameIcon size={13} fill={p.streak > 0 ? "var(--color-accent)" : "var(--color-neutral-700)"} />
          <span style={{ ...heading(12), ...tabular }}>{p.streak}</span>
        </button>
      </div>

      <div ref={scroller} onScroll={onScroll} className="ov-feed ov-hide">
        {showNote && (
          <section className="ov-reel">
            <div className="ov-center-note">
              {p.status === "error" ? (
                <>
                  <span>Couldn&apos;t load reels</span>
                  <button onClick={p.onRetry} className="ov-pill hov-edge" style={{ fontSize: 13, letterSpacing: 0, textTransform: "none" }}>Try again</button>
                </>
              ) : p.status === "ready" ? (
                <span>No reels yet</span>
              ) : (
                <>
                  <span className="ov-spinner" />
                  <span className="ov-pulse">Loading reels</span>
                  <p className="ov-seo-intro">
                    Outvids is a free feed of AI-generated reels. Swipe, and give an Outvid to the ones you love.{" "}
                    <a href="/about">How it works</a>
                  </p>
                </>
              )}
            </div>
          </section>
        )}

        {items.slice(0, rendered).map((item, i) => {
          if (item.kind === "promo") {
            return <PromoSlide key={item.id} leader={p.leader} reels={p.reels} onOpen={p.goBoard} />;
          }
          const clip = item.clip;
          const near = i >= active - WINDOW_BEHIND && i <= active + WINDOW_AHEAD;
          const isActive = i === active;
          const voted = p.isVoted(clip.id);
          return (
            <section
              key={clip.id}
              className="ov-reel"
              data-clip={clip.id}
              onPointerDown={onPointerDown}
              onPointerUp={(e) => onPointerUp(clip, e)}
            >
              {near ? (
                <ReelVideo
                  clip={clip}
                  active={isActive}
                  paused={isActive && paused}
                  muted={p.muted}
                  preload={isActive || i === active + 1 ? "auto" : "metadata"}
                  register={(v) => (v ? videos.current.set(clip.id, v) : videos.current.delete(clip.id))}
                  tracker={tracker.current!}
                  onSoundBlocked={() => p.setMuted(true)}
                />
              ) : null}
              <span className="ov-reel-top-scrim" />
              <span className="ov-reel-scrim" />

              {isActive && paused && (
                <span className="ov-pause-badge" aria-hidden="true"><PlayIcon size={28} /></span>
              )}

              <div className="ov-reel-foot">
                {p.leader ? (
                  <a href={p.leader.link} target="_blank" rel="sponsored noopener noreferrer" className="ov-pill hov-edge" style={{ fontSize: 12, color: "var(--color-neutral-800)", maxWidth: "100%" }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                      Sponsored by <span style={{ color: "var(--color-text)", fontWeight: 600 }}>{p.leader.brand}</span> ↗
                    </span>
                  </a>
                ) : (
                  <button onClick={p.goBoard} className="ov-pill hov-edge" style={{ fontSize: 12, color: "var(--color-neutral-800)", maxWidth: "100%" }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--color-accent)", flex: "none" }} className="ov-pulse" />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                      Sponsor slot open · <span style={{ color: "var(--color-text)", fontWeight: 600 }}>Outbid</span>
                    </span>
                  </button>
                )}
              </div>

              <div className="ov-rail">
                <button onClick={() => p.setMuted(!p.muted)} aria-label={p.muted ? "Turn sound on" : "Mute"} className="ov-rail-btn">
                  <SpeakerIcon key={String(p.muted)} muted={p.muted} size={19} style={{ animation: "ovIconSwap var(--duration-fast) var(--ease-in-out) both" }} />
                </button>

                <button onClick={() => p.onVote(clip)} aria-label="Outvid this reel" aria-pressed={voted} className="ov-rail-btn">
                  {voted && (
                    <span key={`bloom-${p.countOf(clip)}`} className="ov-bloom" style={{
                      position: "absolute", inset: -14, borderRadius: "50%", pointerEvents: "none",
                      background: "radial-gradient(circle, rgba(255,77,28,.42), transparent 62%)",
                    }} />
                  )}
                  <span key={`icon-${voted}`} className={voted ? "ov-pop" : undefined} style={{ display: "flex", position: "relative" }}>
                    <FlameIcon size={19} />
                  </span>
                  <span key={`count-${p.countOf(clip)}`} className="ov-count" style={{ position: "relative", fontSize: 10, fontWeight: 500, ...tabular }}>
                    {short(p.countOf(clip))}
                  </span>
                </button>

                <button onClick={() => p.onShare(clip)} aria-label="Share this reel" className="ov-rail-btn">
                  <ShareIcon size={19} />
                </button>
              </div>

              {burst?.id === clip.id && <FlameBurst x={`${burst.x}px`} y={`${burst.y}px`} id={burst.n} />}
            </section>
          );
        })}
      </div>
    </>
  );
}

type ReelVideoProps = {
  clip: FeedClip;
  active: boolean;
  paused: boolean;
  muted: boolean;
  preload: "auto" | "metadata";
  register: (v: HTMLVideoElement | null) => void;
  tracker: WatchTracker;
  onSoundBlocked: () => void;
};

function ReelVideo({ clip, active, paused, muted, preload, register, tracker, onSoundBlocked }: ReelVideoProps) {
  const ref = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const soundBlocked = useRef(onSoundBlocked);
  soundBlocked.current = onSoundBlocked;

  // React doesn't reflect `muted` as an attribute on first render; iOS needs it there to allow autoplay.
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = muted;
    v.defaultMuted = muted;
    if (muted) v.setAttribute("muted", "");
    else v.removeAttribute("muted");
  }, [muted]);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (active && !paused) {
      v.play().catch((err: DOMException) => {
        // Autoplay with sound was refused: fall back to muted and try again.
        if (err?.name === "NotAllowedError" && !v.muted) {
          soundBlocked.current();
          v.muted = true;
          v.play().catch(() => {});
        }
      });
    } else {
      v.pause();
      if (!active) v.currentTime = 0;
    }
  }, [active, paused]);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    register(v);
    const id = clip.id;
    const onPlaying = () => tracker.playing(id);
    const onStop = () => tracker.paused(id);
    const onTime = () => tracker.time(id, v.currentTime);
    const onReady = () => setReady(true);
    v.addEventListener("playing", onPlaying);
    v.addEventListener("pause", onStop);
    v.addEventListener("waiting", onStop);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("loadeddata", onReady);
    if (v.readyState >= 2) setReady(true);
    return () => {
      v.removeEventListener("playing", onPlaying);
      v.removeEventListener("pause", onStop);
      v.removeEventListener("waiting", onStop);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("loadeddata", onReady);
      register(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip.id, tracker]);

  return (
    <>
      {!ready && active && (
        <div className="ov-center-note"><span className="ov-spinner" /></div>
      )}
      <video
        ref={ref}
        className="ov-video"
        data-ready={ready}
        src={clip.url}
        muted
        loop
        playsInline
        preload={preload}
        disablePictureInPicture
        controlsList="nodownload noplaybackrate noremoteplayback"
        aria-label="Reel"
      />
    </>
  );
}
