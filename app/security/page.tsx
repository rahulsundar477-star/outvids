import type { Metadata } from "next";
import Link from "next/link";
import SecurityForm from "@/components/SecurityForm";

// A utility page: reachable from /.well-known/security.txt, kept out of search results.
export const metadata: Metadata = {
  title: { absolute: "Report a security issue — Outvids" },
  description:
    "How to report a vulnerability in outvids.lol, and what we promise in return.",
  alternates: { canonical: "/security" },
  robots: { index: false, follow: false },
};

export default function Security() {
  return (
    <main className="ov-doc">
      <nav className="ov-doc-nav" aria-label="Site">
        <Link href="/" className="ov-doc-brand">
          OUTVIDS<span>$</span>
        </Link>
        <Link href="/" className="ov-doc-cta ov-doc-cta--small">
          Open the feed
        </Link>
      </nav>

      <header className="ov-doc-hero ov-reveal">
        <h1 style={{ fontSize: "clamp(34px, 9vw, 52px)" }}>
          Report a security issue
        </h1>
        <p>
          Found a way to break Outvids — the feed, the votes, or{" "}
          <strong>Outbid</strong> payments? Tell us here. Reports go straight to
          the person who builds it, and nothing you send is published.
        </p>
      </header>

      <section aria-labelledby="rules" className="ov-doc-section">
        <h2 id="rules">Good-faith research is welcome</h2>
        <p>
          If you act in good faith, we won&apos;t pursue you for testing. Please
          stay inside these lines:
        </p>
        <ul
          style={{
            color: "var(--color-neutral-800)",
            fontSize: 15.5,
            lineHeight: 1.6,
            margin: "0 0 22px",
            paddingLeft: 20,
          }}
        >
          <li>
            Only use accounts, listings and payments you own. In test mode, use
            Dodo&apos;s test cards — never a real one.
          </li>
          <li>
            No denial of service, load testing, spam, or social engineering.
          </li>
          <li>
            Don&apos;t read, change or keep other people&apos;s data. Stop once
            you&apos;ve shown the issue.
          </li>
          <li>
            Give us a reasonable chance to fix it before telling anyone else.
          </li>
        </ul>
        <p>
          Payments are handled by Dodo Payments as merchant of record. Card
          details never touch outvids.lol, so issues in the checkout page itself
          belong with them.
        </p>
      </section>

      <section aria-labelledby="send" className="ov-doc-section">
        <h2 id="send">Send a report</h2>
        <SecurityForm />
      </section>

      <footer className="ov-doc-foot">
        <Link href="/" className="ov-doc-brand">
          OUTVIDS<span>$</span>
        </Link>
        <span>
          <a
            href="/.well-known/security.txt"
            style={{ color: "inherit", display: "inline-flex", alignItems: "center", minHeight: 44 }}
          >
            security.txt
          </a>{" "}
          · outvids.lol
        </span>
      </footer>
    </main>
  );
}
