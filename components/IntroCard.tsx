"use client";

import { FlameIcon } from "./icons";
import { heading } from "./styles";

type Props = { onBoard: () => void; onClose: () => void; leaving: boolean };

/** Shown once per device, a moment after the first reel starts: what this is and what you can do here. */
export default function IntroCard({ onBoard, onClose, leaving }: Props) {
  return (
    <div
      className="ov-intro"
      data-leaving={leaving}
      role="dialog"
      aria-label="Welcome to Outvids"
    >
      <button onClick={onClose} className="ov-intro-close" aria-label="Close">
        ×
      </button>
      <div style={{ ...heading(17), letterSpacing: "-.02em" }}>
        AI reels, ranked by you
      </div>
      <ul className="ov-intro-list">
        <li>
          <span className="ov-intro-ico" aria-hidden="true">
            ↑
          </span>
          Swipe for the next reel
        </li>
        <li>
          <span className="ov-intro-ico" aria-hidden="true">
            <FlameIcon size={13} fill="var(--color-accent)" />
          </span>
          Double-tap to Outvid the ones you love
        </li>
        <li>
          <span className="ov-intro-ico" aria-hidden="true">
            $
          </span>
          Brands bid to put their link on every reel
        </li>
      </ul>
      <div className="ov-intro-actions">
        <button onClick={onClose} className="ov-intro-ghost">
          Start watching
        </button>
        <button onClick={onBoard} className="ov-intro-cta">
          See Outbid
        </button>
      </div>
    </div>
  );
}
