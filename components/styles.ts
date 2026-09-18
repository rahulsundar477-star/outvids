import type { CSSProperties } from "react";

export const glassPill: CSSProperties = {
  display: "flex",
  alignItems: "center",
  background: "rgba(11,10,10,.5)",
  backdropFilter: "blur(18px)",
  WebkitBackdropFilter: "blur(18px)",
  border: "1px solid rgba(245,241,234,.10)",
  borderRadius: 999,
};

export const heading = (size: number, weight = 600): CSSProperties => ({
  fontFamily: "var(--font-heading)",
  fontWeight: weight,
  fontSize: size,
});

export const eyebrow = (margin: string): CSSProperties => ({
  fontSize: 10,
  letterSpacing: ".16em",
  textTransform: "uppercase",
  color: "var(--color-neutral-700)",
  margin,
});

export const body: CSSProperties = {
  fontSize: 13.5,
  lineHeight: 1.6,
  color: "var(--color-neutral-800)",
  margin: 0,
  textWrap: "pretty",
};

export const tabular: CSSProperties = { fontVariantNumeric: "tabular-nums" };

export const mono = (size: number, radius: number | string, fill: string, ink: string, font: number): CSSProperties => ({
  flex: "none",
  width: size,
  height: size,
  borderRadius: radius,
  background: fill,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: "var(--font-heading)",
  fontWeight: 700,
  fontSize: font,
  color: ink,
});

export const ctaButton = (fill: string, ink: string, glow: string, size = 17, radius = 18): CSSProperties => ({
  width: "100%",
  cursor: "pointer",
  border: 0,
  borderRadius: radius,
  minHeight: 56,
  background: fill,
  color: ink,
  fontFamily: "var(--font-heading)",
  fontWeight: 700,
  fontSize: size,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 9,
  boxShadow: glow,
});

export const screen: CSSProperties = { position: "absolute", inset: 0, overflowY: "auto" };
