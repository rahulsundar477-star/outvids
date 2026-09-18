"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { body, eyebrow, heading } from "./styles";

type Props = { viewer: string; onClose: () => void; toast: (msg: string) => void; onReset: () => void };

const LEGAL = ["Terms of Service", "Privacy Policy", "Content policy", "Contact the team"];

const CREATOR_RULES = [
  "Reels are portrait, ten seconds, and generated on Outvids. Footage you did not generate here is removed.",
  "Outvids are the only public ranking signal for reels. Bought votes, vote rings, and multi-account voting remove the reel and the streak behind it.",
  "Keep it yours. Do not generate a real person's likeness without their consent, and do not pass off someone else's prompt or workflow as your own.",
  "No sexual content, no gore, no hate, and nothing involving minors. Generated or not, the rule is the same.",
  "Streaks and crew tiers are earned by watching and posting. Automating either resets both to zero.",
  "The sponsor watermark stays on every reel while a brand holds the board. It is the only ad on Outvids.",
];

const B = ({ children }: { children: ReactNode }) => <span style={{ color: "var(--color-text)", fontWeight: 600 }}>{children}</span>;

const BRAND_SECTIONS: { title: string; paras: ReactNode[] }[] = [
  {
    title: "How ranking works",
    paras: [
      "New listings are whole US dollars, $10 minimum, $999,999 maximum, $1 at a time. Ranks already on the board keep their amount until they raise or get outranked.",
      "Taking #1 costs at least $5 more than the current #1. Paying less still puts you on the board at whatever rank that amount can take. Equal amounts stay in the order they were placed — the older listing keeps the higher rank.",
      "Taking today's #1 costs at least $5 more than the most anyone else spent since midnight UTC.",
      "Already on the list? Enter the same URL or @handle again and raise your rank. The new amount must be at least $1 above your current rank; checkout only charges the difference. Someone else cannot take your rank by paying that difference.",
      "App Store, Play Store, GitHub, and similar platform links are keyed by their path, so different apps don't share a rank. Tracking query strings are ignored.",
    ],
  },
  {
    title: "What you can list",
    paras: [
      "A product website, or an X @handle.",
      "Chat and invite links are not allowed — Telegram, WhatsApp, Discord, Messenger, Signal, and similar. The board is for products and profiles, not group chats.",
      "Links to sexual content are not allowed. If it is porn, NSFW, or an adult platform, it does not belong on the board.",
      "Query parameters are stripped from listing links. Affiliate, referral, and tracking URLs will not work.",
      "Link shortener URLs are not allowed. If you submit one, it is replaced by the URL it redirects to.",
    ],
  },
  {
    title: "Categories",
    paras: [
      "Categories for existing listings were auto-assigned by AI. If your product is in the wrong category, message the Outvids team on X to have it changed.",
    ],
  },
  {
    title: "After you pay",
    paras: [
      "Your listing is public. Clicks go to the URL or profile you submitted, without query parameters.",
      "A completed payment is what claims the rank. Payments are not refundable.",
      "Paying means you agree to the Terms of Service and Privacy Policy, including the requirement that listed projects show valid company details.",
    ],
  },
];

const subhead = { ...heading(15), margin: "22px 0 8px" };
const stack = { display: "flex", flexDirection: "column", gap: 12 } as const;

export default function SettingsScreen({ viewer, onClose, toast, onReset }: Props) {
  const [confirmReset, setConfirmReset] = useState(false);
  const resetT = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(resetT.current), []);

  function reset() {
    if (!confirmReset) {
      setConfirmReset(true);
      clearTimeout(resetT.current);
      resetT.current = setTimeout(() => setConfirmReset(false), 3000);
      return;
    }
    onReset();
  }

  return (
    <div className="ov-screen ov-hide ov-page" data-screen-label="Settings" style={{ zIndex: 60, background: "var(--color-bg)" }}>
      <div style={{
        position: "sticky", top: 0, zIndex: 2, display: "flex", alignItems: "center", gap: 10,
        padding: "calc(12px + var(--safe-top)) calc(16px + var(--safe-right)) 12px calc(16px + var(--safe-left))",
        background: "rgba(11,10,10,.86)", backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)", borderBottom: "1px solid var(--color-divider)",
      }}>
        <button
          onClick={onClose}
          aria-label="Back to profile"
          className="hov-accent"
          style={{
            flex: "none", width: 40, height: 40, cursor: "pointer", borderRadius: "50%", background: "rgba(245,241,234,.05)",
            border: "1px solid var(--color-divider)", color: "var(--color-text)", fontSize: 17, display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >‹</button>
        <span style={{ ...heading(17), letterSpacing: "-.02em" }}>Settings</span>
      </div>

      <div style={{ padding: "18px calc(18px + var(--safe-right)) calc(36px + var(--safe-bottom)) calc(18px + var(--safe-left))" }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 12, padding: 14, borderRadius: 20,
          background: "linear-gradient(180deg, rgba(245,241,234,.045), rgba(245,241,234,.012)), var(--color-surface)",
          border: "1px solid rgba(245,241,234,.08)", boxShadow: "inset 0 1px 0 rgba(245,241,234,.06)",
        }}>
          <span style={{
            flex: "none", width: 44, height: 44, borderRadius: "50%", background: "linear-gradient(145deg, rgba(255,77,28,.30), rgba(255,77,28,.05))",
            display: "flex", alignItems: "center", justifyContent: "center", ...heading(17), color: "var(--color-accent-300)",
          }}>G</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", ...heading(15) }}>Guest</span>
            <span style={{ display: "block", fontSize: 12.5, color: "var(--color-neutral-700)", marginTop: 2, ...{ fontVariantNumeric: "tabular-nums" } }}>
              Device {viewer.slice(0, 6) || "……"} · no account needed
            </span>
          </span>
        </div>

        <a href="/about" className="hov-row" style={{
          display: "flex", alignItems: "center", gap: 10, marginTop: 12, padding: "14px 16px", minHeight: 52, borderRadius: 18,
          background: "var(--color-surface)", border: "1px solid rgba(245,241,234,.08)", color: "var(--color-text)", fontSize: 14.5,
        }}>
          <span style={{ flex: 1 }}>About Outvids &amp; FAQ</span>
          <span style={{ color: "var(--color-neutral-700)" }}>›</span>
        </a>

        <div style={eyebrow("26px 0 10px")}>Every video here is AI-generated</div>
        <p style={body}>
          Outvids is a platform for AI-generated reels. Every video on the feed was generated — there is no camera footage on the platform, and nothing here should be read as a recording of a real event.
        </p>

        <div style={eyebrow("28px 0 10px")}>How the feed is ordered</div>
        <div style={stack}>
          <p style={body}>
            Every hour the feed is re-ranked from how often each reel is <B>finished</B> or <B>skipped</B>, its <B>Outvid rate</B>, and a small boost for
            reels few people have seen yet. Your phone then shuffles that list, so no two people get the same order.
          </p>
          <p style={body}>
            Watch data is anonymous and never shown. The Outvid count on each reel is the only public number — one per person, per reel.
          </p>
        </div>

        <div style={eyebrow("28px 0 10px")}>Rules for creators</div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {CREATOR_RULES.map((rule, i) => (
            <p key={i} style={{ ...body, marginBottom: i === CREATOR_RULES.length - 1 ? 0 : 12 }}>{rule}</p>
          ))}
        </div>

        <div style={eyebrow("28px 0 10px")}>Rules for brands</div>
        <p style={body}>
          Outbid is a public leaderboard. There are no ads, no API keys, and no revenue share. You pay to stand above everyone else. Rank is what you pay — nothing else.
        </p>

        <div style={subhead}>The boards</div>
        <p style={{ ...body, marginBottom: 12 }}>One payment ranks you on every board that includes that spend. The boards just look at different windows of time.</p>
        <div style={stack}>
          <p style={body}><B>All-time</B> is the main board. Rank is everything you have ever paid for that listing. It does not expire.</p>
          <p style={body}><B>Today</B> is the current UTC calendar day — midnight to midnight. Rank is what you spent since midnight UTC. The board resets when the next day starts.</p>
          <p style={body}><B>Daily</B> is every UTC calendar day — midnight to midnight — starting August 21, 2026. The current day stays live until it closes; past days freeze as an archive. Rank is what you spent that day.</p>
        </div>

        {BRAND_SECTIONS.map((section) => (
          <div key={section.title}>
            <div style={subhead}>{section.title}</div>
            <div style={stack}>
              {section.paras.map((para, i) => <p key={i} style={body}>{para}</p>)}
            </div>
          </div>
        ))}

        <div style={eyebrow("30px 0 10px")}>Legal</div>
        <div style={{
          borderRadius: 20, overflow: "hidden",
          background: "linear-gradient(180deg, rgba(245,241,234,.04), rgba(245,241,234,.01)), var(--color-surface)", border: "1px solid rgba(245,241,234,.08)",
        }}>
          {LEGAL.map((name, i) => (
            <button
              key={name}
              onClick={() => toast(name)}
              className="hov-row"
              style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%", cursor: "pointer", background: "none", border: 0,
                borderTop: `1px solid ${i === 0 ? "transparent" : "var(--color-divider)"}`, padding: "15px 16px", minHeight: 54,
                textAlign: "left", color: "var(--color-text)", fontSize: 14.5,
              }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>{name}</span>
              <span style={{ flex: "none", color: "var(--color-neutral-700)", fontSize: 15 }}>›</span>
            </button>
          ))}
        </div>

        <button
          onClick={reset}
          className="hov-danger"
          style={{
            width: "100%", marginTop: 22, cursor: "pointer", minHeight: 54, borderRadius: 18,
            background: confirmReset ? "rgba(224,69,58,.22)" : "rgba(224,69,58,.10)",
            border: "1px solid rgba(224,69,58,.34)", color: "#F08A80", ...heading(15),
          }}
        >
          <span key={String(confirmReset)} className="ov-count">{confirmReset ? "Tap again to clear streak, stats and Outvids here" : "Reset this device"}</span>
        </button>
        <div style={{ fontSize: 11.5, color: "var(--color-neutral-700)", marginTop: 12, textAlign: "center" }}>Outvids · v1.0</div>
      </div>
    </div>
  );
}
