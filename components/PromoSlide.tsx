"use client";

import { usd } from "@/lib/data";
import {
  MIN_LISTING_CENTS,
  TAKE_TOP_MARGIN_CENTS,
  type BoardEntry,
} from "@/lib/listing";
import { FlameIcon } from "./icons";
import { heading, tabular } from "./styles";

type Props = { leader: BoardEntry | null; reels: number; onOpen: () => void };

/**
 * A full-height card inside the feed that explains Outbid. No video, no network: it reuses the
 * board data the app already loaded, so it costs nothing extra to render.
 */
export default function PromoSlide({ leader, reels, onOpen }: Props) {
  const price = leader
    ? (leader.total_cents + TAKE_TOP_MARGIN_CENTS) / 100
    : MIN_LISTING_CENTS / 100;

  return (
    <section
      className="ov-reel ov-promo"
      data-promo="outbid"
      aria-label="Put your brand on Outvids"
    >
      <div className="ov-promo-glow" aria-hidden="true" />
      <div className="ov-promo-inner">
        <span className="ov-promo-kicker">
          <span className="ov-promo-dot" />
          Sponsor slot
        </span>

        <h2 className="ov-promo-title">
          Your brand
          <br />
          on <span>every reel</span>
        </h2>

        <p className="ov-promo-body">
          {leader ? (
            <>
              <strong>{leader.brand}</strong> holds #1 at{" "}
              {usd(leader.total_cents / 100)}. Outbid them and your link runs on
              all {reels || "the"} reels until someone outbids you.
            </>
          ) : (
            <>
              Nobody holds #1 yet. Take it and your link runs on all{" "}
              {reels || "the"} reels until someone outbids you.
            </>
          )}
        </p>

        <div className="ov-promo-steps">
          {[
            ["01", "Add your link"],
            ["02", "Set your bid"],
            ["03", "Go live"],
          ].map(([n, label]) => (
            <span key={n} className="ov-promo-step">
              <b style={tabular}>{n}</b>
              {label}
            </span>
          ))}
        </div>

        <button onClick={onOpen} className="ov-promo-cta">
          <FlameIcon size={18} />
          <span>{leader ? "Take #1" : "Claim #1"}</span>
          <span className="ov-promo-price" style={tabular}>
            from {usd(price)}
          </span>
        </button>

        <span className="ov-promo-foot" style={{ ...heading(12), ...tabular }}>
          One payment · live in seconds · no subscription
        </span>
      </div>
    </section>
  );
}
