"use client";

import { usd } from "@/lib/data";
import { ctaButton, heading, tabular } from "./styles";

export type Quote = {
  brand: string;
  link: string;
  category: string;
  targetDollars: number;
  priorDollars: number;
  chargeDollars: number;
  rank: number;
};

type Props = {
  quote: Quote;
  enabled: boolean;
  testMode: boolean;
  paying: boolean;
  error: string | null;
  leaving: boolean;
  onPay: () => void;
  onClose: () => void;
};

export default function PaySheet({
  quote: q,
  enabled,
  testMode,
  paying,
  error,
  leaving,
  onPay,
  onClose,
}: Props) {
  const rows = [
    { label: "Listing", value: q.brand },
    { label: "Category", value: q.category },
    { label: "Board total after", value: usd(q.targetDollars) },
    { label: "Due now", value: `${usd(q.chargeDollars)} + tax` },
  ];

  return (
    <div
      className="ov-backdrop"
      data-leaving={leaving}
      onClick={(e) => e.target === e.currentTarget && !paying && onClose()}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 90,
        background: "rgba(5,4,4,.62)",
        display: "flex",
        alignItems: "flex-end",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Confirm your bid"
        className="ov-sheet ov-hide"
        data-leaving={leaving}
        style={{
          width: "100%",
          maxHeight: "94%",
          overflowY: "auto",
          background: "var(--color-bg)",
          borderRadius: "28px 28px 0 0",
          boxShadow: "var(--shadow-lg)",
          borderTop: "1px solid rgba(245,241,234,.08)",
        }}
      >
        <div style={{ padding: "10px 18px calc(24px + var(--safe-bottom))" }}>
          <div
            style={{
              width: 38,
              height: 4,
              borderRadius: 999,
              background: "rgba(245,241,234,.16)",
              margin: "0 auto 10px",
            }}
          />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span
              style={{
                fontSize: 10,
                letterSpacing: ".16em",
                textTransform: "uppercase",
                color: "var(--color-neutral-700)",
              }}
            >
              {q.priorDollars > 0 ? "Raise your listing" : "Confirm your bid"}
            </span>
            <button
              onClick={onClose}
              disabled={paying}
              aria-label="Close"
              className="hov-text"
              style={{
                cursor: paying ? "default" : "pointer",
                background: "rgba(245,241,234,.05)",
                border: 0,
                borderRadius: "50%",
                width: 36,
                height: 36,
                fontSize: 20,
                color: "var(--color-neutral-700)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              ×
            </button>
          </div>

          <div
            style={{
              ...heading(0),
              fontSize: "clamp(48px, 16cqi, 66px)",
              lineHeight: 1,
              letterSpacing: "-.045em",
              marginTop: 14,
              ...tabular,
            }}
          >
            {usd(q.chargeDollars)}
          </div>
          <div
            style={{
              fontSize: 15,
              color: "var(--color-neutral-800)",
              marginTop: 10,
              lineHeight: 1.45,
            }}
          >
            {q.priorDollars > 0 ? (
              <>
                Raises{" "}
                <span style={{ color: "var(--color-text)", fontWeight: 600 }}>
                  {q.brand}
                </span>{" "}
                from {usd(q.priorDollars)} to {usd(q.targetDollars)}.
              </>
            ) : (
              <>
                Enters the board at{" "}
                <span style={{ color: "var(--color-text)", fontWeight: 600 }}>
                  #{q.rank}
                </span>{" "}
                as {q.brand}.
              </>
            )}
          </div>

          <div
            style={{
              marginTop: 18,
              background: "var(--color-surface)",
              borderRadius: 18,
              overflow: "hidden",
            }}
          >
            {rows.map((r, i) => (
              <div
                key={r.label}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  gap: 12,
                  padding: "13px 16px",
                  borderTop: `1px solid ${i === 0 ? "transparent" : "var(--color-divider)"}`,
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    color: "var(--color-neutral-700)",
                    flex: "none",
                  }}
                >
                  {r.label}
                </span>
                <span
                  style={{
                    ...heading(15),
                    ...tabular,
                    textAlign: "right",
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {r.value}
                </span>
              </div>
            ))}
          </div>

          {testMode && enabled && (
            <div
              role="note"
              style={{
                marginTop: 12,
                padding: "11px 14px",
                borderRadius: 14,
                background: "rgba(250,204,21,.08)",
                border: "1px solid rgba(250,204,21,.3)",
                color: "#FACC15",
                fontSize: 12.5,
                lineHeight: 1.5,
              }}
            >
              <b style={{ fontWeight: 700 }}>Test mode — no real money.</b>
              <br />
              Card <span style={{ ...tabular, fontWeight: 600 }}>4242 4242 4242 4242</span>, expiry{" "}
              <span style={tabular}>06/32</span>, CVV <span style={tabular}>123</span>.
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="ov-reveal"
              style={{
                marginTop: 12,
                padding: "11px 14px",
                borderRadius: 14,
                background: "rgba(224,69,58,.10)",
                border: "1px solid rgba(224,69,58,.3)",
                color: "#F08A80",
                fontSize: 13,
                lineHeight: 1.45,
              }}
            >
              {error}
            </div>
          )}

          <button
            onClick={onPay}
            disabled={!enabled || paying}
            className={enabled && !paying ? "hov-pay" : undefined}
            style={{
              ...ctaButton(
                enabled ? "var(--color-accent)" : "rgba(245,241,234,.06)",
                enabled ? "#0B0A0A" : "var(--color-neutral-700)",
                enabled ? "var(--shadow-md)" : "none",
              ),
              marginTop: 16,
              justifyContent: "space-between",
              padding: "0 20px",
              cursor: enabled && !paying ? "pointer" : "default",
            }}
          >
            <span>
              {!enabled
                ? "Checkout isn't switched on yet"
                : paying
                  ? "Opening secure checkout…"
                  : "Continue to secure checkout"}
            </span>
            {enabled && !paying ? (
              <span style={{ fontSize: 14, opacity: 0.85, ...tabular }}>
                {usd(q.chargeDollars)}
              </span>
            ) : paying ? (
              <span className="ov-spinner" style={{ width: 20, height: 20 }} />
            ) : null}
          </button>

          <div
            style={{
              fontSize: 11.5,
              color: "var(--color-neutral-700)",
              marginTop: 11,
              textAlign: "center",
              lineHeight: 1.5,
              textWrap: "pretty",
            }}
          >
            {enabled ? (
              <>
                Paid through Dodo Payments, the merchant of record. Sales tax,
                VAT or GST for your country is added at checkout. Your rank is
                set once the payment is confirmed.
              </>
            ) : (
              <>
                Nothing was charged. Bids open as soon as payments are switched
                on.
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
