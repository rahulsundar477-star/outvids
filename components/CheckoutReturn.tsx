"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { usd } from "@/lib/data";

type Status = {
  bid_id: string;
  status:
    | "confirming"
    | "paid"
    | "review"
    | "failed"
    | "cancelled"
    | "expired"
    | "refunded"
    | "disputed";
  brand: string;
  link: string;
  charge_cents: number;
  target_cents: number;
  paid_total: number | null;
  paid_tax: number | null;
  paid_currency: string | null;
  rank: number | null;
};

const POLL_MS = 2500;
const GIVE_UP_MS = 3 * 60_000;
const FLAME =
  "M143.4 17.7a8 8 0 0 0-12.6 5.1c-2.6 24.2-14.7 42.9-27.5 62.7-3.6 5.6-7.3 11.2-10.7 17-9.4-9.9-14.5-24.4-14.6-24.6a8 8 0 0 0-12.7-3.2C39.8 93.2 32 118.4 32 144a96 96 0 0 0 192 0c0-58.6-42.3-101.5-80.6-126.3Z";

const money = (minor: number | null, currency: string | null) => {
  if (minor == null || !currency) return null;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
};

/**
 * Where Dodo sends the buyer back. The `status` query param is only a hint and is never trusted:
 * this page polls the Worker, which reads D1 and double-checks with Dodo server-side.
 */
export default function CheckoutReturn() {
  const params = useSearchParams();
  const bidId = params.get("bid") || "";
  const cancelled = params.get("cancelled") === "1";
  const [data, setData] = useState<Status | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const started = useRef(Date.now());

  useEffect(() => {
    if (!/^bid_[0-9a-f]{24}$/.test(bidId)) {
      setProblem(
        "This checkout link is missing its order. Nothing new was charged.",
      );
      return;
    }
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const res = await fetch(`/api/checkout/status?bid=${bidId}`, {
          cache: "no-store",
        });
        if (res.status === 404) {
          setProblem("We couldn't find this order.");
          return;
        }
        if (res.ok) {
          const s: Status = await res.json();
          setData(s);
          if (s.status !== "confirming") return; // final state
        }
      } catch {
        // network blip: keep polling
      }
      if (Date.now() - started.current > GIVE_UP_MS) {
        setSlow(true);
        return;
      }
      if (!stop) timer = setTimeout(poll, POLL_MS);
    };
    poll();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [bidId]);

  const status = problem ? "problem" : (data?.status ?? "confirming");
  const effective =
    cancelled && status === "confirming" ? "cancelled-hint" : status;
  const paidTotal = money(
    data?.paid_total ?? null,
    data?.paid_currency ?? null,
  );
  const paidTax = money(data?.paid_tax ?? null, data?.paid_currency ?? null);

  const copy: Record<
    string,
    { title: string; body: string; tone: "ok" | "wait" | "bad" }
  > = {
    confirming: {
      title: slow ? "Still confirming" : "Confirming your payment",
      body: slow
        ? "Dodo hasn't confirmed this payment yet. If you paid, your rank appears as soon as it does. You can close this page."
        : "This takes a few seconds. Don't pay twice.",
      tone: "wait",
    },
    "cancelled-hint": {
      title: "Checkout closed",
      body: "You left checkout, so you weren't charged. We're double-checking with Dodo.",
      tone: "wait",
    },
    paid: {
      title: data?.rank ? `You're #${data.rank}` : "Payment confirmed",
      body: `${data?.brand ?? "Your listing"} is on the board at ${usd((data?.target_cents ?? 0) / 100)}.`,
      tone: "ok",
    },
    review: {
      title: "Payment received — under review",
      body: "Your payment went through but something didn't match our order, so we're checking it by hand before it goes on the board. You don't need to do anything.",
      tone: "wait",
    },
    failed: {
      title: "Payment didn't go through",
      body: "You weren't charged. Try again from the Outbid board.",
      tone: "bad",
    },
    cancelled: {
      title: "Checkout cancelled",
      body: "You weren't charged.",
      tone: "bad",
    },
    expired: {
      title: "Checkout expired",
      body: "You weren't charged. Start a new bid from the board.",
      tone: "bad",
    },
    refunded: {
      title: "Refunded",
      body: "This payment was refunded and the listing was removed from the board.",
      tone: "bad",
    },
    disputed: {
      title: "Payment disputed",
      body: "This listing is off the board while the dispute is open.",
      tone: "bad",
    },
    problem: { title: "Order not found", body: problem ?? "", tone: "bad" },
  };
  const c = copy[effective] ?? copy.confirming;
  const accent =
    c.tone === "ok"
      ? "var(--color-accent)"
      : c.tone === "bad"
        ? "#E0453A"
        : "var(--color-neutral-700)";

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        textAlign: "center",
        padding: "40px 0",
      }}
    >
      <div
        key={effective}
        className={c.tone === "ok" ? "ov-check" : "ov-reveal"}
        style={{
          position: "relative",
          width: 88,
          height: 88,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {c.tone === "wait" ? (
          <span
            className="ov-spinner"
            style={{ width: 44, height: 44, borderWidth: 3 }}
          />
        ) : (
          <svg viewBox="0 0 256 256" width="72" height="72" aria-hidden="true">
            <path fill={accent} d={FLAME} />
          </svg>
        )}
      </div>
      <h1
        key={`t-${effective}`}
        className="ov-reveal"
        style={{
          fontSize: "clamp(28px, 8vw, 40px)",
          margin: "18px 0 8px",
          letterSpacing: "-.035em",
        }}
      >
        {c.title}
      </h1>
      <p role="status" style={{ maxWidth: 380, margin: "0 auto" }}>
        {c.body}
      </p>

      {data && effective === "paid" && (paidTotal || paidTax) && (
        <div
          className="ov-reveal"
          style={{
            marginTop: 18,
            width: "100%",
            maxWidth: 380,
            borderRadius: 18,
            background: "var(--color-surface)",
            border: "1px solid rgba(245,241,234,.08)",
            textAlign: "left",
          }}
        >
          {[
            ["Bid", usd(data.charge_cents / 100)],
            ["Tax", paidTax ?? "—"],
            ["Total charged", paidTotal ?? "—"],
          ].map(([k, v], i) => (
            <div
              key={k}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "12px 16px",
                borderTop: i ? "1px solid var(--color-divider)" : 0,
                fontSize: 14,
              }}
            >
              <span style={{ color: "var(--color-neutral-700)" }}>{k}</span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>{v}</span>
            </div>
          ))}
        </div>
      )}

      <Link href="/?tab=board" className="ov-doc-cta" style={{ marginTop: 26 }}>
        {effective === "paid" ? "See the board" : "Back to Outbid"}
      </Link>
      {data?.bid_id && (
        <div
          style={{
            marginTop: 14,
            fontSize: 11.5,
            color: "var(--color-neutral-700)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          Order {data.bid_id}
        </div>
      )}
    </div>
  );
}
