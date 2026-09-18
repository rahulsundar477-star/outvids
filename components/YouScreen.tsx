"use client";

import type { CSSProperties, RefObject } from "react";
import { localDay, nextMilestone, tasteOf, weekOf, type DeviceState } from "@/lib/device";
import type { FeedClip } from "@/lib/feed";
import { short } from "@/lib/data";
import { FlameIcon, GearIcon, LockIcon } from "./icons";
import { ctaButton, eyebrow, heading, tabular } from "./styles";

type Props = {
  device: DeviceState;
  clips: FeedClip[];
  streak: number;
  onWatch: () => void;
  onSettings: () => void;
  scrollRef: RefObject<HTMLDivElement | null>;
  streakRef: RefObject<HTMLDivElement | null>;
};

const BIG = 10_000;

/** Reveal with a 40ms stagger per item (transitions-polish: keep the total under ~300ms). */
const reveal = (i: number): CSSProperties => ({ animationDelay: `calc(var(--duration-stagger) * ${Math.min(i, 6)})` });

const card: CSSProperties = {
  background: "linear-gradient(180deg, rgba(245,241,234,.05), rgba(245,241,234,.012)), var(--color-surface)",
  border: "1px solid rgba(245,241,234,.08)", boxShadow: "inset 0 1px 0 rgba(245,241,234,.07), 0 10px 26px rgba(0,0,0,.28)",
};

const emptyNote: CSSProperties = {
  padding: "16px", borderRadius: 18, border: "1px dashed rgba(245,241,234,.13)", fontSize: 13, lineHeight: 1.45,
  color: "var(--color-neutral-700)", textWrap: "pretty",
};

export default function YouScreen(p: Props) {
  const d = p.device;
  const watchedToday = d.days.includes(localDay());
  const week = weekOf(d.days);
  const taste = tasteOf(d);
  const outvids = Object.keys(d.voted).length;
  const milestone = nextMilestone(p.streak);

  const viewsById = new Map(p.clips.map((c) => [c.id, c.views]));
  const calls = Object.entries(d.voted)
    .sort((a, b) => b[1].at - a[1].at)
    .map(([id, v]) => {
      const now = viewsById.get(id) ?? v.views;
      const early = v.views < BIG;
      return { id, now, early, big: early && now >= BIG };
    });
  const early = calls.filter((c) => c.early);
  const wentBig = early.filter((c) => c.big).length;

  const recap = [
    { n: d.finished, label: "watched", ink: "var(--color-text)" },
    { n: outvids, label: "flamed", ink: outvids ? "var(--color-accent-300)" : "var(--color-text)" },
    { n: d.days.length, label: d.days.length === 1 ? "day active" : "days active", ink: "var(--color-text)" },
  ];

  const streakNote =
    p.streak === 0
      ? "Finish a reel today to start your streak."
      : watchedToday
        ? `Streak safe today. ${milestone - p.streak} more ${milestone - p.streak === 1 ? "day" : "days"} to ${milestone}.`
        : "Finish a reel today to keep it going.";

  return (
    <div ref={p.scrollRef} className="ov-screen ov-hide ov-page" data-screen-label="You">
      <div className="ov-pad" style={{ paddingBottom: 44 }}>
        <div style={{ display: "flex", gap: 14, alignItems: "center", paddingBottom: 2 }}>
          <span style={{
            flex: "none", width: 60, height: 60, borderRadius: "50%",
            background: "linear-gradient(145deg, rgba(255,77,28,.26), rgba(255,77,28,.04))", boxShadow: "inset 0 1px 0 rgba(255,138,102,.28)",
            display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-accent-300)",
          }}><FlameIcon size={24} /></span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ fontSize: 22, margin: 0 }}>You</h2>
            <span style={{ display: "block", fontSize: 13, color: "var(--color-neutral-700)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              Guest · saved on this device
            </span>
          </span>
          <button
            onClick={p.onSettings}
            aria-label="Settings"
            className="hov-accent"
            style={{
              flex: "none", width: 44, height: 44, cursor: "pointer", borderRadius: "50%", background: "rgba(245,241,234,.05)",
              border: "1px solid var(--color-divider)", color: "var(--color-neutral-800)", display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <GearIcon size={19} />
          </button>
        </div>

        {/* Crew — nobody is in one yet. */}
        <div className="ov-reveal" style={{
          marginTop: 16, padding: 18, borderRadius: 26,
          background: "radial-gradient(110% 130% at 0% 0%, rgba(255,77,28,.10), rgba(255,77,28,.015) 60%), linear-gradient(180deg, rgba(245,241,234,.05), rgba(245,241,234,.012)), var(--color-surface)",
          border: "1px solid rgba(255,77,28,.18)", boxShadow: "inset 0 1px 0 rgba(255,138,102,.12), 0 16px 40px rgba(0,0,0,.42)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{ fontSize: 10, letterSpacing: ".16em", textTransform: "uppercase", color: "var(--color-accent-300)" }}>Your crew · Tier 0 of 4</span>
            <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--color-neutral-700)", ...tabular }}>0 members</span>
          </div>
          <div style={{ ...heading(22), letterSpacing: "-.02em", marginTop: 8 }}>No crew yet</div>
          <div style={{ fontSize: 12.5, color: "var(--color-neutral-700)", marginTop: 4 }}>0% to Night Shift · watched together</div>
          <div style={{ height: 6, background: "rgba(245,241,234,.10)", borderRadius: 999, overflow: "hidden", marginTop: 13 }}>
            <span className="ov-bar" style={{ display: "block", height: "100%", borderRadius: 999, transform: "scaleX(0)", background: "linear-gradient(90deg, var(--color-accent-600), var(--color-accent-300))" }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14 }}>
            <span style={{ display: "flex" }}>
              {[0, 1, 2].map((i) => (
                <span key={i} style={{ width: 26, height: 26, marginLeft: i ? -8 : 0, borderRadius: "50%", border: "1.5px dashed rgba(245,241,234,.2)", background: "var(--color-surface)" }} />
              ))}
            </span>
            <span style={{ fontSize: 12, color: "var(--color-neutral-700)", ...tabular }}>0 watching now</span>
            <span style={{
              marginLeft: "auto", flex: "none", display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 999,
              background: "rgba(245,241,234,.05)", border: "1px solid var(--color-divider)", fontSize: 11, color: "var(--color-neutral-800)",
            }}>
              <LockIcon size={11} />Crews
            </span>
          </div>
        </div>

        <div ref={p.streakRef} className="ov-reveal" style={{ ...reveal(1), marginTop: 14, padding: 18, background: "var(--color-surface)", borderRadius: 26 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <FlameIcon size={24} fill={p.streak > 0 ? "var(--color-accent)" : "rgba(245,241,234,.26)"} />
            <span key={p.streak} className="ov-count" style={{ ...heading(0), fontSize: "clamp(34px, 10.5cqi, 40px)", lineHeight: 1, letterSpacing: "-.03em", ...tabular }}>{p.streak}</span>
            <span style={{ ...heading(16), paddingTop: 6 }}>day streak</span>
          </div>
          <div style={{ display: "flex", gap: 7, marginTop: 16 }}>
            {week.map((day, i) => (
              <span key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                <span style={{
                  width: "100%", height: 5, borderRadius: 999,
                  background: day.done ? "var(--color-accent)" : day.today ? "var(--color-accent-200)" : "rgba(245,241,234,.10)",
                  transition: "background-color var(--duration-fast) var(--ease-smooth-out)",
                }} />
                <span style={{ fontSize: 10, color: day.today ? "var(--color-accent-300)" : "var(--color-neutral-700)", fontWeight: day.today ? 600 : 400 }}>{day.label}</span>
              </span>
            ))}
          </div>
          <div style={{ fontSize: 13, color: "var(--color-neutral-800)", marginTop: 14, lineHeight: 1.45 }}>{streakNote}</div>
          <button
            onClick={p.onWatch}
            disabled={watchedToday}
            style={{
              ...ctaButton(
                watchedToday ? "rgba(245,241,234,.06)" : "linear-gradient(180deg, var(--color-accent), var(--color-accent-600))",
                watchedToday ? "var(--color-neutral-700)" : "#0B0A0A",
                watchedToday ? "none" : "0 10px 30px rgba(255,77,28,.32), inset 0 1px 0 rgba(255,255,255,.28)",
                16,
              ),
              marginTop: 14,
              cursor: watchedToday ? "default" : "pointer",
            }}
          >
            <span>{watchedToday ? "Streak safe today" : p.streak ? "Keep your streak" : "Start watching"}</span>
            <span style={{ fontSize: 13, opacity: 0.85 }}>{watchedToday ? "✓" : `Day ${p.streak + 1}`}</span>
          </button>
        </div>

        <div style={{ display: "flex", gap: 9, marginTop: 14 }}>
          {recap.map((r, i) => (
            <span key={r.label} className="ov-reveal" style={{ ...card, ...reveal(i + 2), flex: 1, minWidth: 0, padding: "15px 14px 13px", borderRadius: 20 }}>
              <span style={{ display: "block", ...heading(0), fontSize: "clamp(22px, 7cqi, 28px)", lineHeight: 1, letterSpacing: "-.03em", ...tabular, color: r.ink }}>{r.n}</span>
              <span style={{ display: "block", fontSize: 11.5, color: "var(--color-neutral-700)", marginTop: 7, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.label}</span>
            </span>
          ))}
        </div>

        <div style={eyebrow("28px 0 12px")}>Your eye</div>
        {taste.length === 0 ? (
          <div style={emptyNote}>Finish {Math.max(1, 3 - d.finished)} more {3 - d.finished === 1 ? "reel" : "reels"} and we&apos;ll show what you actually watch through.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {taste.map((t, i) => (
              <span key={t.key} className="ov-reveal" style={{ display: "block", ...reveal(i) }}>
                <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13.5 }}>{t.label}</span>
                  <span style={{ flex: "none", ...heading(13), color: i < 2 ? "var(--color-accent-300)" : "var(--color-neutral-700)", ...tabular }}>{t.share}%</span>
                </span>
                <span style={{ display: "block", height: 4, borderRadius: 999, background: "rgba(245,241,234,.08)", marginTop: 8, overflow: "hidden" }}>
                  <span className="ov-fill" style={{
                    display: "block", height: "100%", width: `${t.share}%`, borderRadius: 999, ...reveal(i + 1),
                    background: i < 2 ? "linear-gradient(90deg, var(--color-accent-600), var(--color-accent-300))" : "rgba(245,241,234,.30)",
                  }} />
                </span>
              </span>
            ))}
          </div>
        )}

        <div style={eyebrow("28px 0 6px")}>Spotted early</div>
        {calls.length === 0 ? (
          <div style={emptyNote}>
            Outvid reels before they hit {short(BIG)} plays. The ones that go big show up here.
          </div>
        ) : (
          <>
            <div style={{ fontSize: 13, color: "var(--color-neutral-800)", lineHeight: 1.45, marginBottom: 13, textWrap: "pretty" }}>
              You flamed <span style={{ color: "var(--color-text)", fontWeight: 600 }}>{early.length} {early.length === 1 ? "reel" : "reels"}</span> before{" "}
              {early.length === 1 ? "it" : "they"} had {short(BIG)} plays.{" "}
              <span style={{ color: wentBig ? "var(--color-accent-300)" : "var(--color-neutral-700)", fontWeight: 600 }}>{wentBig} went big.</span>
            </div>
            <div style={{ display: "flex", gap: 9 }}>
              {calls.slice(0, 3).map((c, i) => (
                <span key={c.id} className="ov-reveal" style={{
                  ...reveal(i), flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 11, padding: 14, borderRadius: 20,
                  background: c.big
                    ? "radial-gradient(120% 130% at 0% 0%, rgba(255,77,28,.13), rgba(255,77,28,.02) 62%), var(--color-surface)"
                    : "linear-gradient(180deg, rgba(245,241,234,.045), rgba(245,241,234,.012)), var(--color-surface)",
                  border: `1px solid ${c.big ? "rgba(255,77,28,.24)" : "rgba(245,241,234,.08)"}`,
                }}>
                  <FlameIcon size={15} fill={c.big ? "var(--color-accent)" : "rgba(245,241,234,.26)"} />
                  <span style={{ display: "block" }}>
                    <span style={{ display: "block", ...heading(22), lineHeight: 1, letterSpacing: "-.03em", ...tabular }}>{short(c.now)}</span>
                    <span style={{ display: "block", fontSize: 11, color: "var(--color-neutral-700)", marginTop: 5 }}>plays now</span>
                  </span>
                  <span style={{ display: "block", fontSize: 9.5, letterSpacing: ".14em", textTransform: "uppercase", color: c.big ? "var(--color-accent-300)" : "var(--color-neutral-700)" }}>
                    {c.big ? "Went big" : "Waiting"}
                  </span>
                </span>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
