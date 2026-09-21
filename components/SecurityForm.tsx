"use client";

import { useState } from "react";

type State =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; id: string }
  | { kind: "error"; message: string };

const label = {
  display: "block",
  fontSize: 13,
  fontWeight: 600,
  color: "var(--color-text)",
  margin: "0 0 6px",
} as const;
const input = {
  width: "100%",
  boxSizing: "border-box",
  minHeight: 48,
  padding: "12px 14px",
  borderRadius: 14,
  border: "1px solid rgba(245,241,234,.12)",
  background: "rgba(245,241,234,.04)",
  color: "var(--color-text)",
  fontSize: 16, // 16px or iOS zooms the page on focus
  fontFamily: "inherit",
  outline: "none",
} as const;
const hint = {
  fontSize: 12.5,
  color: "var(--color-neutral-700)",
  margin: "6px 0 0",
} as const;

export default function SecurityForm() {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setState({ kind: "sending" });
    try {
      const res = await fetch("/api/security-report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          summary: form.get("summary"),
          details: form.get("details"),
          url: form.get("url"),
          contact: form.get("contact"),
          website: form.get("website"), // honeypot, hidden from people
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        id?: string;
        message?: string;
      };
      if (res.ok) setState({ kind: "sent", id: data.id ?? "" });
      else
        setState({
          kind: "error",
          message:
            data.message ?? "That didn't go through. Try again in a moment.",
        });
    } catch {
      setState({
        kind: "error",
        message: "No connection. Your report wasn't sent — try again.",
      });
    }
  }

  if (state.kind === "sent")
    return (
      <div
        role="status"
        className="ov-reveal"
        style={{
          padding: 18,
          borderRadius: 20,
          border: "1px solid rgba(74,222,128,.3)",
          background: "rgba(74,222,128,.06)",
        }}
      >
        <p style={{ margin: 0, color: "var(--color-text)", fontWeight: 600 }}>
          Thanks — your report is in.
        </p>
        <p style={{ margin: "6px 0 0", fontSize: 14 }}>
          Reference <code>{state.id}</code>. If you left a way to reach you,
          we&apos;ll reply there.
        </p>
      </div>
    );

  const sending = state.kind === "sending";
  return (
    <form
      onSubmit={onSubmit}
      noValidate={false}
      style={{ display: "grid", gap: 16 }}
    >
      <div>
        <label htmlFor="sr-summary" style={label}>
          What did you find?
        </label>
        <input
          id="sr-summary"
          name="summary"
          required
          minLength={5}
          maxLength={200}
          style={input}
          placeholder="e.g. Checkout accepts an amount below the minimum"
        />
      </div>
      <div>
        <label htmlFor="sr-details" style={label}>
          Steps to reproduce and impact
        </label>
        <textarea
          id="sr-details"
          name="details"
          required
          minLength={20}
          maxLength={8000}
          rows={7}
          style={{
            ...input,
            minHeight: 150,
            resize: "vertical",
            lineHeight: 1.5,
          }}
          placeholder="What you did, what happened, and what an attacker could do with it."
        />
      </div>
      <div>
        <label htmlFor="sr-url" style={label}>
          Affected page or endpoint{" "}
          <span style={{ fontWeight: 400, color: "var(--color-neutral-700)" }}>
            (optional)
          </span>
        </label>
        <input
          id="sr-url"
          name="url"
          maxLength={500}
          inputMode="url"
          autoCapitalize="none"
          spellCheck={false}
          style={input}
          placeholder="https://outvids.lol/…"
        />
      </div>
      <div>
        <label htmlFor="sr-contact" style={label}>
          How can we reach you?{" "}
          <span style={{ fontWeight: 400, color: "var(--color-neutral-700)" }}>
            (optional)
          </span>
        </label>
        <input
          id="sr-contact"
          name="contact"
          maxLength={200}
          autoCapitalize="none"
          spellCheck={false}
          style={input}
          placeholder="Email, X handle, or anything else"
        />
        <p style={hint}>Only used to reply about this report.</p>
      </div>
      {/* Honeypot: invisible to people and screen readers; bots fill every field. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "-10000px",
          width: 1,
          height: 1,
          overflow: "hidden",
        }}
      >
        <label htmlFor="sr-website">Website</label>
        <input
          id="sr-website"
          name="website"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>
      {state.kind === "error" && (
        <p role="alert" style={{ margin: 0, color: "#F08A80", fontSize: 14 }}>
          {state.message}
        </p>
      )}
      <button
        type="submit"
        className="ov-doc-cta"
        disabled={sending}
        style={{
          border: 0,
          cursor: sending ? "wait" : "pointer",
          opacity: sending ? 0.7 : 1,
        }}
      >
        {sending ? "Sending…" : "Send report"}
      </button>
    </form>
  );
}
