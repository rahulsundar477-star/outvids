"use client";

import type { RefObject } from "react";
import { num, usd } from "@/lib/data";
import {
  CATEGORIES,
  MIN_LISTING_CENTS,
  MIN_RAISE_CENTS,
  TAKE_TOP_MARGIN_CENTS,
  isLinkError,
  normalizeListing,
  rankFor,
  type Board,
} from "@/lib/listing";
import { GlobeIcon } from "./icons";
import { ctaButton, heading, mono, tabular } from "./styles";

export type BoardRange = "all" | "today";

type Props = {
  reels: number;
  board: Board | null;
  /** All-time board: the server computes "already paid" from it, whatever range is shown. */
  allBoard: Board | null;
  boardStatus: "loading" | "ready" | "error";
  range: BoardRange;
  setRange: (r: BoardRange) => void;
  cat: string;
  setCat: (c: string) => void;
  bid: number; // dollars
  setBid: (dollars: number) => void;
  linkField: string;
  setLinkField: (v: string) => void;
  linkRef: RefObject<HTMLInputElement | null>;
  clock: string;
  onBid: () => void;
};

const RANGES: { id: BoardRange; name: string }[] = [
  { id: "all", name: "All-time" },
  { id: "today", name: "Today" },
];

const roundBtn = {
  flex: "none",
  width: 44,
  height: 44,
  cursor: "pointer",
  borderRadius: "50%",
  fontSize: 22,
  lineHeight: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
} as const;

export default function BoardScreen(p: Props) {
  const entries = p.board?.entries ?? [];
  const listing = p.linkField.trim() ? normalizeListing(p.linkField) : null;
  const key = listing && !isLinkError(listing) ? listing.key : undefined;
  const mine = key ? (p.allBoard?.entries ?? []).find((e) => e.key === key) : undefined;
  const prior = mine?.total_cents ?? 0;
  const minDollars =
    (prior > 0 ? prior + MIN_RAISE_CENTS : MIN_LISTING_CENTS) / 100;
  const targetCents = p.bid * 100;
  const rank = rankFor(targetCents, entries, key);
  const top = entries.find((e) => e.key !== key);
  const takeTop = Math.max(
    minDollars,
    top ? (top.total_cents + TAKE_TOP_MARGIN_CENTS) / 100 : minDollars,
  );
  const linkOk = !!listing && !isLinkError(listing);
  const rangeIndex = RANGES.findIndex((r) => r.id === p.range);

  return (
    <div
      className="ov-screen ov-hide ov-page"
      data-screen-label="Outbid"
      style={{
        background:
          "radial-gradient(120% 60% at 50% 0%, rgba(255,77,28,.10), rgba(11,10,10,0) 58%), var(--color-bg)",
      }}
    >
      <div className="ov-pad">
        <div style={{ display: "flex", justifyContent: "center" }}>
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 14px",
              borderRadius: 999,
              background:
                "linear-gradient(180deg, rgba(245,241,234,.07), rgba(245,241,234,.02))",
              border: "1px solid rgba(245,241,234,.09)",
              boxShadow: "inset 0 1px 0 rgba(245,241,234,.07)",
              fontSize: 12,
              color: "var(--color-neutral-700)",
            }}
          >
            <span
              className="ov-pulse"
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: "#4ADE80",
                boxShadow: "0 0 8px rgba(74,222,128,.7)",
              }}
            />
            <span style={{ color: "#7DE8A4", fontWeight: 600, ...tabular }}>
              {num(p.reels)} reels live
            </span>
            <span>·</span>
            <span>
              {entries.length ? `${entries.length} on the board` : "board open"}
            </span>
          </span>
        </div>

        {p.allBoard?.mode === "test_mode" && (
          <div style={{ display: "flex", justifyContent: "center", marginTop: 10 }}>
            <span role="note" style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "6px 12px", borderRadius: 999, background: "rgba(250,204,21,.10)", border: "1px solid rgba(250,204,21,.35)", color: "#FACC15", fontSize: 12, fontWeight: 600 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#FACC15" }} />
              Test mode · no real charges
            </span>
          </div>
        )}

        <div
          style={{ display: "flex", justifyContent: "center", marginTop: 12 }}
        >
          <div className="ov-seg" role="group" aria-label="Board range">
            <span
              className="ov-seg-thumb"
              style={{
                width: `calc((100% - 8px) / ${RANGES.length})`,
                transform: `translateX(${rangeIndex * 100}%)`,
              }}
            />
            {RANGES.map((r) => {
              const on = p.range === r.id;
              return (
                <button
                  key={r.id}
                  onClick={() => p.setRange(r.id)}
                  aria-pressed={on}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: on
                        ? "rgba(11,10,10,.5)"
                        : "var(--color-accent)",
                      transition:
                        "background-color var(--duration-fast) var(--ease-smooth-out)",
                    }}
                  />
                  {r.name}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ textAlign: "center", marginTop: 26 }}>
          <div
            style={{
              ...heading(0),
              fontSize: "clamp(24px, 7.4cqi, 30px)",
              letterSpacing: "-.03em",
              lineHeight: 1.1,
            }}
          >
            {prior > 0 ? "Raise your listing to" : `Claim #${rank} for`}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 14,
              marginTop: 12,
            }}
          >
            <button
              onClick={() => p.setBid(Math.max(minDollars, p.bid - 10))}
              aria-label="Lower your bid"
              className="hov-accent"
              disabled={p.bid <= minDollars}
              style={{
                ...roundBtn,
                background:
                  "linear-gradient(180deg, rgba(245,241,234,.08), rgba(245,241,234,.02))",
                border: "1px solid rgba(245,241,234,.10)",
                boxShadow: "inset 0 1px 0 rgba(245,241,234,.08)",
                color: "var(--color-neutral-800)",
                opacity: p.bid <= minDollars ? 0.4 : 1,
              }}
            >
              −
            </button>
            <span
              key={p.bid}
              className="ov-count"
              style={{
                ...heading(0),
                fontSize: "clamp(42px, 14cqi, 56px)",
                lineHeight: 1,
                letterSpacing: "-.045em",
                color: "var(--color-accent-300)",
                textShadow: "0 0 34px rgba(255,77,28,.35)",
                minWidth: "3ch",
                ...tabular,
              }}
            >
              {usd(p.bid)}
            </span>
            <button
              onClick={() => p.setBid(Math.min(999_999, p.bid + 10))}
              aria-label="Raise your bid"
              className="hov-fill"
              style={{
                ...roundBtn,
                background:
                  "linear-gradient(180deg, rgba(255,77,28,.22), rgba(255,77,28,.08))",
                border: "1px solid rgba(255,77,28,.38)",
                boxShadow: "inset 0 1px 0 rgba(255,138,102,.28)",
                color: "var(--color-accent-300)",
              }}
            >
              +
            </button>
          </div>
          <div
            style={{
              fontSize: 12.5,
              color: "var(--color-neutral-700)",
              marginTop: 12,
              lineHeight: 1.5,
              ...tabular,
            }}
          >
            {prior > 0 ? (
              <>
                You&apos;re at {usd(prior / 100)} · pay{" "}
                {usd(Math.max(0, p.bid - prior / 100))} to reach #{rank}
              </>
            ) : top ? (
              <>
                Enters at #{rank} · #1 is {top.brand} at{" "}
                {usd(top.total_cents / 100)}
              </>
            ) : (
              <>Enters at #1 · no one holds the board yet</>
            )}
          </div>
          {top && p.bid < takeTop && (
            <button
              onClick={() => p.setBid(takeTop)}
              className="hov-edge"
              style={{
                marginTop: 10,
                cursor: "pointer",
                minHeight: 34,
                padding: "0 14px",
                borderRadius: 999,
                background: "rgba(255,77,28,.08)",
                border: "1px solid rgba(255,77,28,.3)",
                color: "var(--color-accent-300)",
                ...heading(12.5),
                ...tabular,
              }}
            >
              Take #1 for {usd(takeTop)}
            </button>
          )}
        </div>

        <div
          style={{
            marginTop: 22,
            padding: 14,
            borderRadius: 26,
            background:
              "linear-gradient(180deg, rgba(245,241,234,.055), rgba(245,241,234,.015))",
            border: "1px solid rgba(245,241,234,.09)",
            boxShadow:
              "inset 0 1px 0 rgba(245,241,234,.07), 0 18px 44px rgba(0,0,0,.45)",
          }}
        >
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 11,
              padding: "0 4px",
              cursor: "text",
            }}
          >
            <GlobeIcon fill="var(--color-neutral-700)" />
            <input
              ref={p.linkRef}
              aria-label="Your product URL or handle"
              value={p.linkField}
              onChange={(e) => p.setLinkField(e.target.value)}
              placeholder="Your product URL or @handle"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              maxLength={300}
              onKeyDown={(e) => e.key === "Enter" && p.onBid()}
              style={{
                flex: 1,
                minWidth: 0,
                minHeight: 48,
                background: "none",
                border: 0,
                outline: "none",
                fontSize: 16,
                color: "var(--color-text)",
              }}
            />
          </label>
          {listing && (
            <div
              style={{
                fontSize: 12,
                padding: "0 6px 6px",
                color: isLinkError(listing)
                  ? "#F08A80"
                  : "var(--color-neutral-700)",
              }}
            >
              {isLinkError(listing) ? (
                listing.error
              ) : (
                <>
                  Lists as{" "}
                  <span style={{ color: "var(--color-text)" }}>
                    {listing.brand}
                  </span>
                  {mine ? " · already on the board" : ""}
                </>
              )}
            </div>
          )}
          <div
            className="ov-hide"
            style={{
              display: "flex",
              gap: 7,
              marginTop: 6,
              padding: "0 2px 2px",
              overflowX: "auto",
              scrollSnapType: "x proximity",
            }}
          >
            {CATEGORIES.map((c) => {
              const on = p.cat === c;
              return (
                <button
                  key={c}
                  onClick={() => p.setCat(c)}
                  aria-pressed={on}
                  style={{
                    flex: "none",
                    cursor: "pointer",
                    borderRadius: 999,
                    padding: "8px 14px",
                    minHeight: 36,
                    ...heading(12.5),
                    scrollSnapAlign: "start",
                    background: on
                      ? "var(--color-accent-200)"
                      : "rgba(245,241,234,.04)",
                    border: `1px solid ${on ? "rgba(255,77,28,.42)" : "rgba(245,241,234,.09)"}`,
                    color: on
                      ? "var(--color-accent-300)"
                      : "var(--color-neutral-800)",
                  }}
                >
                  {c}
                </button>
              );
            })}
          </div>
          <button
            onClick={p.onBid}
            style={{
              ...ctaButton(
                linkOk
                  ? "linear-gradient(180deg, var(--color-accent), var(--color-accent-600))"
                  : "rgba(245,241,234,.06)",
                linkOk ? "#0B0A0A" : "var(--color-neutral-700)",
                linkOk
                  ? "0 10px 30px rgba(255,77,28,.34), inset 0 1px 0 rgba(255,255,255,.28)"
                  : "none",
              ),
              marginTop: 10,
            }}
          >
            <span>
              {linkOk
                ? prior > 0
                  ? "Raise rank"
                  : `Take #${rank}`
                : "Add your link"}
            </span>
            <span style={{ fontSize: 14, opacity: 0.8, ...tabular }}>
              {usd(Math.max(0, p.bid - prior / 100))}
            </span>
          </button>
          <div
            style={{
              fontSize: 11.5,
              color: "var(--color-neutral-700)",
              marginTop: 10,
              textAlign: "center",
              lineHeight: 1.5,
              ...tabular,
            }}
          >
            {usd(MIN_LISTING_CENTS / 100)} minimum · plus tax where it applies ·
            Today resets in {p.clock}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            margin: "30px 2px 10px",
          }}
        >
          <span style={{ ...heading(17), letterSpacing: "-.02em" }}>
            {p.range === "today" ? "Today's board" : "All-time board"}
          </span>
          <span style={{ fontSize: 12, color: "var(--color-neutral-700)" }}>
            {entries.length} {entries.length === 1 ? "brand" : "brands"}
          </span>
        </div>

        {p.boardStatus === "loading" && !p.board ? (
          <div
            style={{ display: "flex", justifyContent: "center", padding: 30 }}
          >
            <span className="ov-spinner" />
          </div>
        ) : entries.length === 0 ? (
          <div
            key={p.range}
            className="ov-reveal"
            style={{
              position: "relative",
              overflow: "hidden",
              padding: "26px 18px",
              borderRadius: 22,
              textAlign: "center",
              background:
                "linear-gradient(180deg, rgba(245,241,234,.035), rgba(245,241,234,.01))",
              border: "1px dashed rgba(245,241,234,.14)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                gap: 6,
                marginBottom: 14,
              }}
            >
              {[1, 2, 3].map((n) => (
                <span
                  key={n}
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    border: "1px dashed rgba(245,241,234,.18)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    ...heading(12, 700),
                    color:
                      n === 1
                        ? "var(--color-accent-300)"
                        : "var(--color-neutral-700)",
                  }}
                >
                  #{n}
                </span>
              ))}
            </div>
            <div style={heading(16)}>
              {p.boardStatus === "error"
                ? "Couldn't load the board"
                : "The board is empty"}
            </div>
            <div
              style={{
                fontSize: 13,
                color: "var(--color-neutral-700)",
                marginTop: 6,
                lineHeight: 1.45,
                textWrap: "pretty",
              }}
            >
              The first brand to bid holds #1 and runs on every reel until
              someone outbids it.
            </div>
            <button
              onClick={() => p.linkRef.current?.focus()}
              className="hov-fill-edge"
              style={{
                marginTop: 14,
                cursor: "pointer",
                minHeight: 40,
                padding: "0 18px",
                borderRadius: 999,
                background: "rgba(245,241,234,.05)",
                border: "1px solid var(--color-neutral-400)",
                color: "var(--color-text)",
                ...heading(13),
              }}
            >
              Be the first
            </button>
          </div>
        ) : (
          <div
            key={p.range}
            style={{ display: "flex", flexDirection: "column", gap: 9 }}
          >
            {entries.map((e, i) => {
              const first = e.rank === 1;
              const title = e.name || e.brand;
              const host = e.link.replace(/^https?:\/\//, "").replace(/\/$/, "");
              const next = Math.max(MIN_LISTING_CENTS, e.total_cents + TAKE_TOP_MARGIN_CENTS);
              const takeIt = (ev: { preventDefault: () => void; stopPropagation: () => void }) => {
                ev.preventDefault();
                ev.stopPropagation();
                p.setBid(next / 100);
                p.linkRef.current?.focus();
              };
              return (
                <a
                  key={e.key}
                  href={e.link}
                  target="_blank"
                  rel="sponsored noopener noreferrer"
                  className="ov-reveal hov-lift"
                  style={{
                    animationDelay: `calc(var(--duration-stagger) * ${Math.min(i, 6)})`,
                    position: "relative",
                    overflow: "hidden",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 12,
                    padding: 14,
                    borderRadius: 22,
                    textDecoration: "none",
                    color: "var(--color-text)",
                    background: first
                      ? "radial-gradient(110% 130% at 0% 0%, rgba(255,77,28,.16), rgba(255,77,28,.03) 62%), linear-gradient(180deg, rgba(245,241,234,.05), rgba(245,241,234,.012))"
                      : "linear-gradient(180deg, rgba(245,241,234,.045), rgba(245,241,234,.012))",
                    border: `1px solid ${first ? "rgba(255,77,28,.34)" : "rgba(245,241,234,.08)"}`,
                    boxShadow: first
                      ? "inset 0 1px 0 rgba(255,138,102,.22), 0 20px 46px rgba(0,0,0,.5)"
                      : "inset 0 1px 0 rgba(245,241,234,.06), 0 12px 30px rgba(0,0,0,.38)",
                  }}
                >
                  {e.icon ? (
                    // A 32px favicon stretched to 52px goes soft, so small icons sit at their own
                    // size on the tile instead. icon_px is 0 for SVG, which scales to anything.
                    <span
                      style={{
                        ...mono(52, 15, "linear-gradient(145deg,#262320,#141312)", "var(--color-text)", 0),
                        border: "1px solid rgba(245,241,234,.10)",
                        boxShadow: "inset 0 1px 0 rgba(245,241,234,.14), 0 6px 16px rgba(0,0,0,.4)",
                        overflow: "hidden",
                      }}
                    >
                      {(() => {
                        const px = e.icon_px ?? 0;
                        const size = px > 0 && px < 96 ? Math.max(26, Math.min(40, px)) : 52;
                        return (
                          <img
                            src={e.icon}
                            alt=""
                            width={size}
                            height={size}
                            loading="lazy"
                            decoding="async"
                            style={{
                              width: size,
                              height: size,
                              borderRadius: size === 52 ? 15 : 8,
                              objectFit: "contain",
                            }}
                          />
                        );
                      })()}
                    </span>
                  ) : (
                    <span
                      style={{
                        ...mono(52, 15, "linear-gradient(145deg,#3A3634,#1C1A19)", "var(--color-neutral-800)", 19),
                        border: "1px solid rgba(245,241,234,.10)",
                        boxShadow: "inset 0 1px 0 rgba(245,241,234,.14), 0 6px 16px rgba(0,0,0,.4)",
                        letterSpacing: "-.02em",
                      }}
                    >
                      {host.slice(0, 2).toUpperCase()}
                    </span>
                  )}

                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <span
                        style={{
                          flex: "none",
                          ...heading(13, 700),
                          color: first ? "var(--color-accent-300)" : "var(--color-neutral-700)",
                          ...tabular,
                        }}
                      >
                        #{e.rank}
                      </span>
                      <span
                        style={{
                          flex: 1,
                          minWidth: 0,
                          ...heading(15),
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {title}
                      </span>
                      <span
                        style={{
                          flex: "none",
                          ...heading(20, 700),
                          letterSpacing: "-.03em",
                          color: first ? "var(--color-accent-300)" : "var(--color-text)",
                          ...tabular,
                        }}
                      >
                        {usd(e.total_cents / 100)}
                      </span>
                    </span>

                    {e.description && (
                      <span
                        style={{
                          display: "block",
                          fontSize: 12.5,
                          color: "var(--color-neutral-700)",
                          lineHeight: 1.4,
                          marginTop: 4,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {e.description}
                      </span>
                    )}

                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginTop: 7,
                        fontSize: 11.5,
                        color: "var(--color-neutral-700)",
                      }}
                    >
                      <span style={{ flex: "none", color: "var(--color-neutral-800)", fontWeight: 600 }}>
                        {e.category}
                      </span>
                      <span
                        style={{
                          minWidth: 0,
                          color: "var(--color-accent-300)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {host} ↗
                      </span>
                    </span>

                    <span
                      role="button"
                      tabIndex={0}
                      onClick={takeIt}
                      onKeyDown={(ev) => {
                        if (ev.key === "Enter" || ev.key === " ") takeIt(ev);
                      }}
                      className="hov-fill-edge"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        marginTop: 11,
                        cursor: "pointer",
                        minHeight: 36,
                        padding: "0 14px",
                        background: "rgba(245,241,234,.05)",
                        border: "1px solid var(--color-neutral-400)",
                        borderRadius: 999,
                        ...heading(12.5),
                        color: "var(--color-text)",
                        ...tabular,
                      }}
                    >
                      Outbid for {usd(next / 100)}
                    </span>
                  </span>
                </a>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
