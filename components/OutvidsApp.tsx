"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  clearDevice,
  emptyDevice,
  loadDevice,
  localDay,
  saveDevice,
  streakOf,
  tasteKeys,
  type DeviceState,
} from "@/lib/device";
import type { Feed, FeedClip } from "@/lib/feed";
import {
  MIN_LISTING_CENTS,
  MIN_RAISE_CENTS,
  isLinkError,
  normalizeListing,
  rankFor,
  type Board,
} from "@/lib/listing";
import { orderFeed } from "@/lib/shuffle";
import type { WatchResult } from "@/lib/watch";
import BoardScreen, { type BoardRange } from "./BoardScreen";
import IntroCard from "./IntroCard";
import FeedScreen from "./FeedScreen";
import PaySheet, { type Quote } from "./PaySheet";
import SettingsScreen from "./SettingsScreen";
import YouScreen from "./YouScreen";

type Page = "feed" | "board" | "you" | "settings";

const TABS: { name: string; page: Page }[] = [
  { name: "Feed", page: "feed" },
  { name: "Outbid", page: "board" },
  { name: "You", page: "you" },
];

const newKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;

export default function OutvidsApp() {
  const [page, setPage] = useState<Page>("feed");
  const [device, setDevice] = useState<DeviceState>(emptyDevice);
  const [hydrated, setHydrated] = useState(false);

  const [feed, setFeed] = useState<Feed | null>(null);
  const [clips, setClips] = useState<FeedClip[]>([]);
  const [feedStatus, setFeedStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [muted, setMuted] = useState(true);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const feedIndex = useRef(0);

  const [boards, setBoards] = useState<Record<BoardRange, Board | null>>({
    all: null,
    today: null,
  });
  const [boardStatus, setBoardStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [bid, setBid] = useState(MIN_LISTING_CENTS / 100);
  const [linkField, setLinkField] = useState("");
  const [range, setRange] = useState<BoardRange>("all");
  const [cat, setCat] = useState("AI");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [sheetLeaving, setSheetLeaving] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const checkoutKey = useRef<string | null>(null);
  const [secs, setSecs] = useState<number | null>(null);
  const [intro, setIntro] = useState<"hidden" | "open" | "leaving">("hidden");

  const [toast, setToast] = useState<{ msg: string; leaving: boolean } | null>(
    null,
  );
  const toastT = useRef<ReturnType<typeof setTimeout>[]>([]);

  const linkRef = useRef<HTMLInputElement>(null);
  const youScrollRef = useRef<HTMLDivElement>(null);
  const streakRef = useRef<HTMLDivElement>(null);

  const updateDevice = useCallback((fn: (d: DeviceState) => DeviceState) => {
    setDevice((prev) => {
      const next = fn(prev);
      saveDevice(next);
      return next;
    });
  }, []);

  useEffect(() => {
    setDevice(loadDevice());
    setHydrated(true);
    if (new URLSearchParams(location.search).get("tab") === "board")
      setPage("board");
  }, []);

  // "Today" board resets at midnight UTC — a real countdown.
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const next = Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + 1,
      );
      setSecs(Math.max(0, Math.floor((next - now.getTime()) / 1000)));
    };
    tick();
    const t = setInterval(tick, 1000);
    const timers = toastT.current;
    return () => {
      clearInterval(t);
      timers.forEach(clearTimeout);
    };
  }, []);

  const showToast = useCallback((msg: string) => {
    toastT.current.forEach(clearTimeout);
    setToast({ msg, leaving: false });
    toastT.current = [
      setTimeout(
        () => setToast((t) => (t ? { ...t, leaving: true } : t)),
        1900,
      ),
      setTimeout(() => setToast(null), 1900 + 350),
    ];
  }, []);

  // The one ranked list, shuffled on this device.
  const loadFeed = useCallback(async (d: DeviceState) => {
    setFeedStatus("loading");
    try {
      const res = await fetch("/feed.json");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: Feed = await res.json();
      const pinned = new URLSearchParams(location.search).get("clip");
      setFeed(data);
      setClips(
        orderFeed(data.clips, `${d.viewer}-${localDay()}`, d.seen, pinned),
      );
      setFeedStatus("ready");
    } catch {
      setFeedStatus("error");
    }
  }, []);

  useEffect(() => {
    if (hydrated) loadFeed(device);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  // The Outbid board: real paid listings only (edge-cached ~30s).
  const loadBoard = useCallback(async (r: BoardRange) => {
    try {
      const res = await fetch(`/api/board?range=${r}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: Board = await res.json();
      setBoards((b) => ({ ...b, [r]: data }));
      setBoardStatus("ready");
    } catch {
      setBoardStatus((s) => (s === "ready" ? s : "error"));
    }
  }, []);

  useEffect(() => {
    loadBoard("all");
  }, [loadBoard]);

  useEffect(() => {
    if (page === "board") {
      loadBoard("all");
      if (range === "today") loadBoard("today");
    }
  }, [page, range, loadBoard]);

  // First visit: explain the place once, after the first reel has started.
  useEffect(() => {
    if (!hydrated || device.intro || feedStatus !== "ready" || !clips.length) return;
    const t = setTimeout(() => setIntro("open"), 2200);
    return () => clearTimeout(t);
  }, [hydrated, device.intro, feedStatus, clips.length]);

  function closeIntro(then?: () => void) {
    setIntro("leaving");
    updateDevice((d) => ({ ...d, intro: Date.now() }));
    setTimeout(() => {
      setIntro("hidden");
      then?.();
    }, 350);
  }

  const generatedAt = feed ? Date.parse(feed.generated_at) : 0;
  const isVoted = useCallback(
    (id: string) => !!device.voted[id],
    [device.voted],
  );
  const countOf = useCallback(
    (clip: FeedClip) => {
      if (counts[clip.id] !== undefined) return counts[clip.id];
      const mine = device.voted[clip.id];
      return clip.votes + (mine && mine.at > generatedAt ? 1 : 0);
    },
    [counts, device.voted, generatedAt],
  );

  async function vote(clip: FeedClip, onlyOn = false) {
    const wasOn = !!device.voted[clip.id];
    if (onlyOn && wasOn) return;
    const on = !wasOn;
    const before = countOf(clip);

    updateDevice((d) => {
      const voted = { ...d.voted };
      if (on) voted[clip.id] = { at: Date.now(), views: clip.views };
      else delete voted[clip.id];
      return { ...d, voted };
    });
    setCounts((c) => ({
      ...c,
      [clip.id]: Math.max(0, before + (on ? 1 : -1)),
    }));
    if (on) showToast("Outvid · pushed up the board");

    try {
      const res = await fetch("/api/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clip_id: clip.id,
          viewer_id: device.viewer,
          on,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: { votes: number } = await res.json();
      setCounts((c) => ({ ...c, [clip.id]: data.votes }));
    } catch {
      updateDevice((d) => {
        const voted = { ...d.voted };
        if (wasOn)
          voted[clip.id] = voted[clip.id] ?? {
            at: Date.now(),
            views: clip.views,
          };
        else delete voted[clip.id];
        return { ...d, voted };
      });
      setCounts((c) => ({ ...c, [clip.id]: before }));
      showToast("Couldn't save that Outvid — try again");
    }
  }

  const onLeave = useCallback(
    (r: WatchResult) => {
      updateDevice((d) => {
        const next: DeviceState = {
          ...d,
          seen: { ...d.seen, [r.clip.id]: Date.now() },
        };
        if (r.finished) {
          const today = localDay();
          next.finished = d.finished + 1;
          next.days = d.days.includes(today)
            ? d.days
            : [...d.days, today].slice(-400);
          next.taste = { ...d.taste };
          for (const k of tasteKeys(r.clip))
            next.taste[k] = (next.taste[k] ?? 0) + 1;
        }
        return next;
      });
    },
    [updateDevice],
  );

  async function share(clip: FeedClip) {
    const url = `${location.origin}/?clip=${encodeURIComponent(clip.id)}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Outvids", url });
        return;
      }
      await navigator.clipboard.writeText(url);
      showToast("Link copied");
    } catch (err) {
      if ((err as DOMException)?.name !== "AbortError")
        showToast("Couldn't share — copy the address bar link");
    }
  }

  function goStreak() {
    setPage("you");
    setTimeout(() => {
      const card = streakRef.current;
      const scroller = youScrollRef.current;
      if (card && scroller)
        scroller.scrollTo({
          top: Math.max(0, card.offsetTop - 84),
          behavior: "smooth",
        });
    }, 60);
  }

  // Preview only — the Worker recomputes everything and is the only authority on the charge.
  function openCheckout() {
    const listing = normalizeListing(linkField);
    if (isLinkError(listing)) {
      showToast(listing.error);
      linkRef.current?.focus();
      return;
    }
    const allEntries = boards.all?.entries ?? [];
    const priorCents =
      allEntries.find((e) => e.key === listing.key)?.total_cents ?? 0;
    const minDollars =
      (priorCents > 0 ? priorCents + MIN_RAISE_CENTS : MIN_LISTING_CENTS) / 100;
    const targetDollars = Math.max(bid, minDollars);
    if (targetDollars !== bid) setBid(targetDollars);

    checkoutKey.current = newKey(); // one key per attempt: a double tap can't open two checkouts
    setPayError(null);
    setPaying(false);
    setSheetLeaving(false);
    setQuote({
      brand: listing.brand,
      link: listing.link,
      category: cat,
      targetDollars,
      priorDollars: priorCents / 100,
      chargeDollars: targetDollars - priorCents / 100,
      rank: rankFor(targetDollars * 100, allEntries, listing.key),
    });
  }

  async function startCheckout() {
    if (!quote || paying) return;
    setPaying(true);
    setPayError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          link: linkField,
          category: quote.category,
          target_dollars: quote.targetDollars,
          idempotency_key: checkoutKey.current,
          viewer_id: device.viewer || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        checkout_url?: string;
        bid_id?: string;
        status?: string;
        error?: string;
        message?: string;
      };
      if (
        res.ok &&
        data.checkout_url &&
        /^https:\/\//.test(data.checkout_url)
      ) {
        location.assign(data.checkout_url); // keep the spinner while the browser leaves
        return;
      }
      if (res.ok && data.status === "paid" && data.bid_id) {
        location.assign(
          `/checkout/return?bid=${encodeURIComponent(data.bid_id)}`,
        );
        return;
      }
      if (data.error !== "checkout_opening") checkoutKey.current = newKey();
      setPayError(
        data.message ||
          "Couldn't open checkout. Nothing was charged — try again.",
      );
      if (data.error === "checkout_disabled") loadBoard("all");
    } catch {
      checkoutKey.current = newKey();
      setPayError("No connection. Nothing was charged — try again.");
    }
    setPaying(false);
  }

  function closeCheckout() {
    if (paying) return;
    setSheetLeaving(true);
    setTimeout(() => {
      setQuote(null);
      setSheetLeaving(false);
    }, 350);
  }

  function resetDevice() {
    clearDevice();
    location.replace("/");
  }

  const streak = useMemo(() => streakOf(device.days), [device.days]);
  const clock =
    secs === null
      ? "--:--:--"
      : [Math.floor(secs / 3600), Math.floor((secs % 3600) / 60), secs % 60]
          .map((n) => String(n).padStart(2, "0"))
          .join(":");
  const tabIndex = TABS.findIndex((t) => t.page === page);
  // Only real (live-mode) payments may sponsor the feed; test-mode listings stay on the board, labelled.
  const leader = boards.all?.mode === "live_mode" ? (boards.all.entries[0] ?? null) : null;

  return (
    <div className="ov-app">
      <div className="ov-stage">
        {page === "feed" && (
          <FeedScreen
            clips={clips}
            status={feedStatus}
            onRetry={() => loadFeed(device)}
            viewer={device.viewer}
            startIndex={feedIndex.current}
            onActive={(i) => (feedIndex.current = i)}
            onLeave={onLeave}
            isVoted={isVoted}
            countOf={countOf}
            onVote={vote}
            onShare={share}
            muted={muted}
            setMuted={setMuted}
            streak={streak}
            leader={leader}
            promoSeed={`${device.viewer}-${localDay()}`}
            reels={feed?.count ?? 0}
            goBoard={() => setPage("board")}
            goStreak={goStreak}
          />
        )}

        {page === "board" && (
          <BoardScreen
            reels={feed?.count ?? 0}
            board={boards[range]}
            allBoard={boards.all}
            boardStatus={boardStatus}
            range={range}
            setRange={setRange}
            cat={cat}
            setCat={setCat}
            bid={bid}
            setBid={setBid}
            linkField={linkField}
            setLinkField={setLinkField}
            linkRef={linkRef}
            clock={clock}
            onBid={openCheckout}
          />
        )}

        {page === "you" && (
          <YouScreen
            device={device}
            clips={feed?.clips ?? []}
            streak={streak}
            onWatch={() => setPage("feed")}
            onSettings={() => setPage("settings")}
            scrollRef={youScrollRef}
            streakRef={streakRef}
          />
        )}

        {page === "settings" && (
          <SettingsScreen
            viewer={device.viewer}
            onClose={() => setPage("you")}
            toast={showToast}
            onReset={resetDevice}
          />
        )}

        {quote && (
          <PaySheet
            quote={quote}
            enabled={boards.all?.enabled ?? false}
            testMode={boards.all?.mode === "test_mode"}
            paying={paying}
            error={payError}
            leaving={sheetLeaving}
            onPay={startCheckout}
            onClose={closeCheckout}
          />
        )}

        {page === "feed" && intro !== "hidden" && (
          <IntroCard
            leaving={intro === "leaving"}
            onClose={() => closeIntro()}
            onBoard={() => closeIntro(() => setPage("board"))}
          />
        )}

        {toast && (
          <div
            role="status"
            className="ov-toast"
            data-leaving={toast.leaving}
            style={{
              position: "absolute",
              left: "50%",
              bottom: 18,
              zIndex: 95,
              width: "max-content",
              maxWidth: "calc(100% - 36px)",
              background: "var(--color-text)",
              color: "var(--color-bg)",
              padding: "10px 16px",
              fontSize: 13,
              lineHeight: 1.35,
              textAlign: "center",
              textWrap: "pretty",
              borderRadius: 14,
              boxShadow: "var(--shadow-md)",
              pointerEvents: "none",
            }}
          >
            {toast.msg}
          </div>
        )}
      </div>

      <nav className="ov-nav" aria-label="Main">
        <span
          className="ov-nav-indicator"
          style={{
            transform: `translateX(${Math.max(0, tabIndex) * 100}%)`,
            opacity: tabIndex < 0 ? 0 : 1,
          }}
        />
        {TABS.map((t) => (
          <button
            key={t.page}
            onClick={() => setPage(t.page)}
            aria-current={page === t.page ? "page" : undefined}
            data-tab={t.page}
          >
            {t.name}
          </button>
        ))}
      </nav>
    </div>
  );
}
