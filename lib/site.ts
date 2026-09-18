/** Brand + SEO constants, shared by metadata, sitemap, structured data and the About page. */

export const SITE = {
  name: "Outvids",
  url: "https://outvids.lol",
  title: "Outvids — AI-generated reels, ranked by Outvids",
  tagline: "AI-generated reels. Outvid the ones you love.",
  description:
    "Outvids is a vertical feed of AI-generated reels. Swipe through short AI videos, give an Outvid to the ones you love, and watch the crowd decide what rises. Free, no account needed.",
  keywords: [
    "Outvids",
    "outvids.lol",
    "AI reels",
    "AI-generated videos",
    "AI video feed",
    "AI short videos",
    "generated reels",
    "vertical video feed",
  ],
  indexNowKey: "195dff258231f2b2b904576ec904ceb6",
} as const;

export const FAQ = [
  {
    q: "What is Outvids?",
    a: "Outvids is a free vertical feed of short AI-generated reels. Every video on it was generated — there is no camera footage. You swipe, watch, and give an Outvid to the reels you love.",
  },
  {
    q: "What is an Outvid?",
    a: "An Outvid is a vote. Tap the flame or double-tap a reel to give one. Each person can give one Outvid per reel, and the Outvid count is the only public number on a reel.",
  },
  {
    q: "How does Outvids decide what to show?",
    a: "Every hour the feed is re-ranked from how often each reel is finished or skipped, its Outvid rate, and a small boost for reels few people have seen yet. Your phone then shuffles that ranked list, so no two people get the same order.",
  },
  {
    q: "Do I need an account?",
    a: "No. Open outvids.lol and start swiping. Your streak and stats are saved on your device.",
  },
  {
    q: "What is Outbid?",
    a: "Outbid is a public leaderboard for brands. There are no ads and no targeting — the brand that pays the most holds #1 and its link runs on every reel until someone outbids it.",
  },
  {
    q: "Are the videos real?",
    a: "No. Every reel on Outvids is AI-generated, and nothing on the platform should be read as a recording of a real event.",
  },
] as const;

export function siteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE.url}/#organization`,
        name: SITE.name,
        url: SITE.url,
        logo: { "@type": "ImageObject", url: `${SITE.url}/icon-512.png`, width: 512, height: 512 },
      },
      {
        "@type": "WebSite",
        "@id": `${SITE.url}/#website`,
        name: SITE.name,
        alternateName: ["Outvids.lol", "Outvid"],
        url: SITE.url,
        description: SITE.description,
        publisher: { "@id": `${SITE.url}/#organization` },
        inLanguage: "en",
      },
      {
        "@type": "WebApplication",
        "@id": `${SITE.url}/#app`,
        name: SITE.name,
        url: SITE.url,
        applicationCategory: "EntertainmentApplication",
        operatingSystem: "Any (web browser)",
        browserRequirements: "Requires JavaScript and HTML5 video",
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        description: SITE.description,
        publisher: { "@id": `${SITE.url}/#organization` },
      },
    ],
  };
}
