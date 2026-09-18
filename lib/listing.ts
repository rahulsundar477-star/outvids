/**
 * Outbid listing rules, shared by the board UI (preview) and the payments Worker (enforcement).
 * Pure functions only — no fetch, no bindings.
 */

export const MIN_LISTING_CENTS = 10_00; // new listings: $10 minimum
export const MIN_RAISE_CENTS = 1_00; // raising your own listing: at least $1 more
export const MAX_LISTING_CENTS = 999_999_00; // $999,999 maximum total
export const TAKE_TOP_MARGIN_CENTS = 5_00; // suggested margin over the current #1

export const CATEGORIES = [
  "AI",
  "SaaS",
  "Apparel",
  "Food",
  "Hardware",
  "Games",
  "Finance",
  "Creator",
  "Other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export type ListingLink = {
  key: string;
  link: string;
  brand: string;
  resolve?: boolean;
};
export type LinkError = { error: string };

// Chat / invite links are not listings.
const CHAT_HOSTS = [
  "t.me",
  "telegram.me",
  "telegram.org",
  "wa.me",
  "whatsapp.com",
  "chat.whatsapp.com",
  "discord.gg",
  "discord.com",
  "discordapp.com",
  "m.me",
  "messenger.com",
  "signal.me",
  "signal.group",
  "line.me",
  "kakao.com",
  "viber.com",
];
// Adult platforms are not allowed.
const ADULT_HOSTS = [
  "pornhub.com",
  "xvideos.com",
  "xnxx.com",
  "xhamster.com",
  "onlyfans.com",
  "fansly.com",
  "redtube.com",
  "youporn.com",
  "brazzers.com",
  "chaturbate.com",
  "stripchat.com",
  "manyvids.com",
  "spankbang.com",
  "eporner.com",
];
const ADULT_WORDS = /(^|[.-])(porn|xxx|nsfw|sex|adult|camgirl|escort)([.-]|$)/;
// Short links get resolved to their destination by the Worker.
export const SHORTENER_HOSTS = [
  "bit.ly",
  "bitly.com",
  "tinyurl.com",
  "t.co",
  "goo.gl",
  "ow.ly",
  "is.gd",
  "buff.ly",
  "cutt.ly",
  "rebrand.ly",
  "shorturl.at",
  "tiny.cc",
  "rb.gy",
  "lnkd.in",
  "s.id",
  "shorte.st",
  "bl.ink",
  "short.io",
];
// Platform links are keyed by their path so two apps don't share a rank.
const PATH_KEYED_HOSTS = [
  "apps.apple.com",
  "play.google.com",
  "github.com",
  "chromewebstore.google.com",
  "producthunt.com",
  "huggingface.co",
  "npmjs.com",
  "x.com",
  "twitter.com",
  "youtube.com",
  "instagram.com",
  "tiktok.com",
  "linkedin.com",
];

const hostMatches = (host: string, list: string[]) =>
  list.some((h) => host === h || host.endsWith("." + h));

/**
 * Turn user input (URL or @handle) into a stable listing key + canonical link.
 * Query strings and fragments are dropped (except Play Store's app id).
 */
export function normalizeListing(input: string): ListingLink | LinkError {
  const raw = (input || "").trim();
  if (!raw) return { error: "Add your product URL or X @handle." };
  if (raw.length > 300) return { error: "That link is too long." };

  // X handle
  const handle = raw.match(/^@([A-Za-z0-9_]{1,15})$/);
  if (handle) {
    const h = handle[1].toLowerCase();
    return {
      key: `x.com/${h}`,
      link: `https://x.com/${handle[1]}`,
      brand: `@${handle[1]}`,
    };
  }

  let url: URL;
  try {
    url = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`,
    );
  } catch {
    return {
      error:
        "That doesn't look like a link. Try https://yourproduct.com or @handle.",
    };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    return { error: "Use an https:// link." };
  if (url.username || url.password)
    return { error: "Links can't contain a username or password." };
  if (url.port && url.port !== "443" && url.port !== "80")
    return { error: "Links can't use a custom port." };

  const host = url.hostname
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/\.$/, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) || /^\d+(\.\d+){3}$/.test(host))
    return { error: "Use a real domain, not an IP address." };
  if (hostMatches(host, CHAT_HOSTS))
    return {
      error:
        "Chat and invite links can't be listed. Use your product site or X @handle.",
    };
  if (hostMatches(host, ADULT_HOSTS) || ADULT_WORDS.test(host))
    return { error: "Adult sites can't be listed." };

  const resolve = hostMatches(host, SHORTENER_HOSTS);

  // x.com / twitter.com profile → same key as @handle
  if (host === "x.com" || host === "twitter.com") {
    const m = url.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/?$/);
    if (m)
      return {
        key: `x.com/${m[1].toLowerCase()}`,
        link: `https://x.com/${m[1]}`,
        brand: `@${m[1]}`,
      };
  }

  let path = url.pathname.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  if (path.length > 200) return { error: "That link path is too long." };
  let query = "";
  if (host === "play.google.com") {
    const id = url.searchParams.get("id");
    if (id && /^[A-Za-z0-9._]{1,150}$/.test(id)) query = `?id=${id}`;
  }

  const pathKeyed = hostMatches(host, PATH_KEYED_HOSTS);
  const keyPath = pathKeyed ? path.toLowerCase() + query : path.toLowerCase();
  const key = `${host}${keyPath}`.slice(0, 260);
  const link = `https://${host}${path}${query}`;
  const brand = pathKeyed && path ? `${host}${path}`.slice(0, 60) : host;
  return { key, link, brand, resolve };
}

export const isLinkError = (v: ListingLink | LinkError): v is LinkError =>
  "error" in v;

/** What a checkout will charge, or why it can't. `priorCents` is the listing's current paid total. */
export function quoteBid(
  targetCents: number,
  priorCents: number,
): { chargeCents: number } | LinkError {
  if (!Number.isInteger(targetCents) || targetCents % 100 !== 0)
    return { error: "Bids are whole US dollars." };
  if (targetCents > MAX_LISTING_CENTS)
    return { error: "The maximum listing total is $999,999." };
  if (priorCents > 0) {
    if (targetCents < priorCents + MIN_RAISE_CENTS)
      return {
        error: `You're already at $${priorCents / 100}. Raise to at least $${(priorCents + MIN_RAISE_CENTS) / 100}.`,
      };
  } else if (targetCents < MIN_LISTING_CENTS) {
    return { error: "New listings start at $10." };
  }
  return { chargeCents: targetCents - priorCents };
}

export type BoardEntry = {
  rank: number;
  key: string;
  link: string;
  brand: string;
  category: string;
  total_cents: number;
  payments: number;
  first_paid_at: number;
  /** Fetched once from the listing's own site after payment (server/enrich.ts). */
  name?: string | null;
  description?: string | null;
  icon?: string | null;
};

export type Board = {
  range: "all" | "today";
  generated_at: string;
  entries: BoardEntry[];
  enabled: boolean;
  /** "test_mode" while Dodo runs in test mode: listings are test money and the UI must say so. */
  mode: "test_mode" | "live_mode";
};

/** Rank a listing total would take on a board (ties go to the older listing, so equal totals rank below). */
export function rankFor(
  totalCents: number,
  entries: BoardEntry[],
  key?: string,
) {
  return (
    entries.filter((e) => e.key !== key && e.total_cents >= totalCents).length +
    1
  );
}
