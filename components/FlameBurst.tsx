import { FLAME_PATH } from "./icons";

const SPARKS = [14, 74, 134, 194, 254, 314].map((deg, i) => {
  const len = i % 2 ? 3 : 4.5;
  return { rot: deg, len, delay: i % 2 ? "var(--duration-stagger)" : "0ms" };
});

/** Double-tap flame: ring + six sparks + flame, anchored at the tap point. A new `id` remounts it so it replays. */
export default function FlameBurst({ x, y, id }: { x: string; y: string; id: number }) {
  return (
    <div key={id} style={{ position: "absolute", left: x, top: y, zIndex: 20, pointerEvents: "none", width: 0, height: 0 }}>
      <span style={{
        position: "absolute", left: 0, top: 0, width: 96, height: 96, borderRadius: "50%",
        border: "1px solid rgba(255,138,102,.5)", animation: "ovRing var(--duration-very-slow) var(--ease-smooth-out) forwards",
      }} />
      {SPARKS.map((k) => (
        <span key={k.rot} style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0, transform: `rotate(${k.rot}deg)` }}>
          <span style={{
            position: "absolute", left: -k.len / 2, top: 0, width: k.len, height: k.len, borderRadius: "50%", opacity: 0,
            background: "var(--color-accent-300)", animation: "ovSpark var(--duration-very-slow) var(--ease-smooth-out) forwards", animationDelay: k.delay,
          }} />
        </span>
      ))}
      <svg
        viewBox="0 0 256 256" width={86} height={86} aria-hidden="true"
        style={{
          position: "absolute", left: 0, top: 0, transform: "translate(-50%,-50%)", opacity: 0,
          filter: "drop-shadow(0 3px 14px rgba(11,10,10,.5))", animation: "ovFlame 600ms var(--ease-smooth-out) forwards",
        }}
      >
        <path d={FLAME_PATH} fill="var(--color-accent)" />
      </svg>
    </div>
  );
}
