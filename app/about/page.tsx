import type { Metadata } from "next";
import Link from "next/link";
import { FAQ, SITE, siteJsonLd } from "@/lib/site";

export const metadata: Metadata = {
  title: { absolute: "About Outvids — how the AI reel feed works" },
  description:
    "What Outvids is: a free feed of AI-generated reels ranked by Outvids (votes), completions and skips. How the feed is ordered, what an Outvid is, and how brands Outbid for the top spot.",
  alternates: { canonical: "/about" },
  openGraph: {
    type: "website",
    url: "/about",
    siteName: "Outvids",
    title: "About Outvids — how the AI reel feed works",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Outvids — AI-generated reels. Outvid the ones you love." }],
  },
};

const FLAME =
  "M143.4 17.7a8 8 0 0 0-12.6 5.1c-2.6 24.2-14.7 42.9-27.5 62.7-3.6 5.6-7.3 11.2-10.7 17-9.4-9.9-14.5-24.4-14.6-24.6a8 8 0 0 0-12.7-3.2C39.8 93.2 32 118.4 32 144a96 96 0 0 0 192 0c0-58.6-42.3-101.5-80.6-126.3Z";

const STEPS = [
  { n: "01", title: "Swipe", text: "A full-screen vertical feed of short AI-generated reels. Sound on with one tap, pause with a tap." },
  { n: "02", title: "Outvid", text: "Tap the flame or double-tap a reel you love. One Outvid per person, per reel — the only public number." },
  { n: "03", title: "It rises", text: "Every hour the feed re-ranks from finishes, skips and Outvid rate, with a boost for reels few have seen." },
];

export default function About() {
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
  const crumbsLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: SITE.name, item: `${SITE.url}/` },
      { "@type": "ListItem", position: 2, name: "About", item: `${SITE.url}/about` },
    ],
  };

  return (
    <main className="ov-doc">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd()) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(crumbsLd) }} />

      <nav className="ov-doc-nav" aria-label="Site">
        <Link href="/" className="ov-doc-brand">OUTVIDS<span>$</span></Link>
        <Link href="/" className="ov-doc-cta ov-doc-cta--small">Open the feed</Link>
      </nav>

      <header className="ov-doc-hero ov-reveal">
        <svg viewBox="0 0 256 256" width="56" height="56" aria-hidden="true"><path fill="var(--color-accent)" d={FLAME} /></svg>
        <h1>Outvids</h1>
        <p className="ov-doc-lede">{SITE.tagline}</p>
        <p>
          Outvids is a free vertical feed of short <strong>AI-generated reels</strong>. Swipe through, give an <strong>Outvid</strong> to the
          ones you love, and the crowd decides what rises. No account, no camera footage — every video on Outvids was generated.
        </p>
        <Link href="/" className="ov-doc-cta">
          <svg viewBox="0 0 256 256" width="18" height="18" aria-hidden="true"><path fill="currentColor" d={FLAME} /></svg>
          Start watching on outvids.lol
        </Link>
      </header>

      <section aria-labelledby="how" className="ov-doc-section">
        <h2 id="how">How Outvids works</h2>
        <ol className="ov-doc-steps">
          {STEPS.map((s, i) => (
            <li key={s.n} className="ov-reveal" style={{ animationDelay: `calc(var(--duration-stagger) * ${i + 1})` }}>
              <span className="ov-doc-step-n">{s.n}</span>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="ranking" className="ov-doc-section">
        <h2 id="ranking">How the feed is ranked</h2>
        <p>
          Outvids keeps two numbers with two jobs. The <strong>Outvid count</strong> on a reel is public: one vote per person, per reel. The{" "}
          <strong>order of the feed</strong> is internal: every hour it is recomputed from how often a reel is finished, how often it is
          skipped, its Outvid rate, and an explore bonus so new reels get seen. Your phone shuffles that ranked list with a daily seed, so a
          refresh doesn&apos;t reshuffle and no two people get the same order.
        </p>
      </section>

      <section aria-labelledby="outbid" id="outbid-section" className="ov-doc-section">
        <h2 id="outbid">Outbid, for brands</h2>
        <p>
          Outbid is a public leaderboard, not an ad network. There is no targeting, no tracking and no revenue share. The brand that pays the
          most holds #1, and its link runs on every reel until someone outbids it. Listings start at $10.
        </p>
      </section>

      <section aria-labelledby="faq" className="ov-doc-section">
        <h2 id="faq">Questions</h2>
        <div className="ov-doc-faq">
          {FAQ.map((f) => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <footer className="ov-doc-foot">
        <Link href="/" className="ov-doc-brand">OUTVIDS<span>$</span></Link>
        <span>AI-generated reels · outvids.lol</span>
      </footer>
    </main>
  );
}
