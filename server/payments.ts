/**
 * Outbid payments on Dodo Payments (merchant of record: Dodo calculates, collects and remits
 * sales tax / VAT / GST for the buyer's country — we record what it charged, we never compute tax).
 *
 * Runs as plain Worker code (routed in worker.ts before Next.js) so every request stays far under
 * the Workers CPU limit. Money safety rules:
 *   1. The server computes the charge. The client only proposes a listing total.
 *   2. The bid row exists in D1 before the buyer ever reaches Dodo.
 *   3. A bid becomes 'paid' only from a verified source — a signed webhook re-checked against the
 *      Dodo API, or a server-side status check — and only if session, product and amount match.
 *      Anything that doesn't match goes to 'review', never onto the board.
 *   4. Every status change is a guarded UPDATE (allowed from-states) + an audit row, in one batch.
 *   5. Webhooks are at-least-once: deduped by webhook-id, and every handler is idempotent.
 *
 * Switched off until DODO_PAYMENTS_API_KEY, DODO_PAYMENTS_WEBHOOK_KEY and DODO_BID_PRODUCT_ID are set.
 */
import DodoPayments from "dodopayments";
import {
  CATEGORIES,
  isLinkError,
  normalizeListing,
  quoteBid,
  rankFor,
  type Board,
  type BoardEntry,
  type ListingLink,
} from "../lib/listing";

type Payment = Awaited<ReturnType<DodoPayments["payments"]["retrieve"]>>;
type Env = CloudflareEnv;
type Ctx = ExecutionContext;
type BidStatus =
  | "created"
  | "pending"
  | "paid"
  | "failed"
  | "cancelled"
  | "expired"
  | "refunded"
  | "disputed"
  | "chargeback"
  | "review"
  | "error";

type BidRow = {
  id: string;
  idempotency_key: string;
  environment: string;
  listing_key: string;
  link: string;
  brand: string;
  category: string;
  prior_cents: number;
  target_cents: number;
  charge_cents: number;
  currency: string;
  status: BidStatus;
  status_reason: string | null;
  checkout_session_id: string | null;
  checkout_url: string | null;
  payment_id: string | null;
  paid_currency: string | null;
  paid_total: number | null;
  paid_tax: number | null;
  created_at: number;
  paid_at: number | null;
  last_checked_at: number | null;
};

const ROUTES = new Set([
  "/api/checkout",
  "/api/checkout/status",
  "/api/webhooks/dodo",
  "/api/board",
]);
export const isPaymentsRoute = (pathname: string) => ROUTES.has(pathname);

const MAX_BODY_BYTES = 64_000;
const SESSION_TTL_MS = 23 * 60 * 60 * 1000; // Dodo checkout URLs live 24h
const STATUS_CHECK_EVERY_MS = 8_000;
const PENDING_EXPIRE_MS = 26 * 60 * 60 * 1000;
const BOARD_CACHE_S = 30;

// ── config ──────────────────────────────────────────────────────────────────

function config(env: Env) {
  const apiKey = env.DODO_PAYMENTS_API_KEY?.trim();
  const webhookKey = env.DODO_PAYMENTS_WEBHOOK_KEY?.trim();
  const productId = env.DODO_BID_PRODUCT_ID?.trim();
  const environment: "test_mode" | "live_mode" =
    (env.DODO_ENVIRONMENT as string) === "live_mode" ? "live_mode" : "test_mode";
  const origin = (env.PUBLIC_ORIGIN || "https://outvids.lol").replace(
    /\/$/,
    "",
  );
  return {
    enabled: Boolean(apiKey && webhookKey && productId),
    apiKey,
    webhookKey,
    productId,
    environment,
    businessId: env.DODO_BUSINESS_ID?.trim() || null,
    origin,
    allowedOrigins: new Set([
      origin,
      "http://localhost:3100",
      "http://localhost:8787",
      "http://127.0.0.1:8787",
    ]),
  };
}
type Config = ReturnType<typeof config>;

function dodo(cfg: Config) {
  return new DodoPayments({
    bearerToken: cfg.apiKey!,
    webhookKey: cfg.webhookKey!,
    environment: cfg.environment,
    maxRetries: 2,
    timeout: 12_000,
  });
}

// ── http helpers ────────────────────────────────────────────────────────────

const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
};

function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...SECURITY_HEADERS,
      ...headers,
    },
  });
}

async function sha256Hex(input: string) {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(buf), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

function randomHex(bytes: number) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function readJson(
  request: Request,
): Promise<Record<string, unknown> | null> {
  const len = Number(request.headers.get("content-length") || 0);
  if (len > MAX_BODY_BYTES) return null;
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

const errMessage = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).slice(0, 300);

// ── router ──────────────────────────────────────────────────────────────────

export async function handlePayments(
  request: Request,
  env: Env,
  ctx: Ctx,
): Promise<Response> {
  const url = new URL(request.url);
  const cfg = config(env);
  try {
    switch (url.pathname) {
      case "/api/board":
        return request.method === "GET"
          ? await getBoard(request, url, env, ctx, cfg)
          : json({ error: "method_not_allowed" }, 405);
      case "/api/checkout":
        return request.method === "POST"
          ? await createCheckout(request, env, cfg)
          : json({ error: "method_not_allowed" }, 405);
      case "/api/checkout/status":
        return request.method === "GET"
          ? await checkoutStatus(url, env, ctx, cfg)
          : json({ error: "method_not_allowed" }, 405);
      case "/api/webhooks/dodo":
        return request.method === "POST"
          ? await dodoWebhook(request, env, ctx, cfg)
          : json({ error: "method_not_allowed" }, 405);
    }
    return json({ error: "not_found" }, 404);
  } catch (err) {
    console.error(
      JSON.stringify({
        payments: "unhandled",
        path: url.pathname,
        error: errMessage(err),
      }),
    );
    return json(
      {
        error: "server_error",
        message: "Something went wrong. Nothing was charged by this request.",
      },
      500,
    );
  }
}

// ── board ───────────────────────────────────────────────────────────────────

const startOfUtcDay = (now = Date.now()) => {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

async function queryBoard(
  env: Env,
  cfg: Config,
  range: "all" | "today",
  limit = 100,
): Promise<BoardEntry[]> {
  const since = range === "today" ? startOfUtcDay() : 0;
  const { results } = await env.DB.prepare(
    `SELECT listing_key AS key,
            MAX(link) AS link, MAX(brand) AS brand, MAX(category) AS category,
            SUM(charge_cents) AS total_cents, COUNT(*) AS payments, MIN(paid_at) AS first_paid_at
       FROM bids
      WHERE environment = ? AND status = 'paid' AND paid_at >= ?
      GROUP BY listing_key
      ORDER BY total_cents DESC, first_paid_at ASC
      LIMIT ?`,
  )
    .bind(cfg.environment, since, limit)
    .all<Omit<BoardEntry, "rank">>();
  return results.map((r, i) => ({
    ...r,
    total_cents: Number(r.total_cents),
    payments: Number(r.payments),
    first_paid_at: Number(r.first_paid_at),
    rank: i + 1,
  }));
}

const boardCacheKey = (cfg: Config, range: string) =>
  `${cfg.origin}/api/board?range=${range}&v=${cfg.environment}`;

async function getBoard(
  request: Request,
  url: URL,
  env: Env,
  ctx: Ctx,
  cfg: Config,
) {
  const range = url.searchParams.get("range") === "today" ? "today" : "all";
  const cache = (caches as unknown as { default: Cache }).default;
  const key = boardCacheKey(cfg, range);
  const hit = await cache.match(key);
  if (hit) return hit;

  const entries = await queryBoard(env, cfg, range);
  const board: Board = {
    range,
    generated_at: new Date().toISOString(),
    entries,
    enabled: cfg.enabled,
    mode: cfg.environment,
  };
  const res = new Response(JSON.stringify(board), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=10, s-maxage=${BOARD_CACHE_S}`,
      "X-Content-Type-Options": "nosniff",
    },
  });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

async function purgeBoard(cfg: Config) {
  const cache = (caches as unknown as { default: Cache }).default;
  await Promise.all(
    ["all", "today"].map((r) => cache.delete(boardCacheKey(cfg, r))),
  );
}

// ── checkout ────────────────────────────────────────────────────────────────

async function createCheckout(request: Request, env: Env, cfg: Config) {
  // Same-origin browsers only (blocks cross-site form posts); JSON only.
  const origin = request.headers.get("origin");
  if (!origin || !cfg.allowedOrigins.has(origin))
    return json({ error: "forbidden_origin" }, 403);
  if (!(request.headers.get("content-type") || "").includes("application/json"))
    return json({ error: "json_required" }, 415);

  if (!cfg.enabled) {
    return json(
      {
        error: "checkout_disabled",
        message: "Checkout isn't switched on yet — nothing was charged.",
      },
      503,
    );
  }

  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const ipHash = (
    await sha256Hex(`${env.IP_HASH_SALT || "outvids"}:${ip}`)
  ).slice(0, 32);
  if (env.CHECKOUT_RL) {
    const { success } = await env.CHECKOUT_RL.limit({ key: ipHash });
    if (!success)
      return json(
        {
          error: "rate_limited",
          message: "Too many checkout attempts. Wait a minute and try again.",
        },
        429,
      );
  }

  const body = await readJson(request);
  if (!body)
    return json({ error: "bad_request", message: "Invalid request." }, 400);

  const idempotencyKey = String(body.idempotency_key ?? "");
  if (!/^[A-Za-z0-9-]{16,64}$/.test(idempotencyKey))
    return json(
      { error: "bad_request", message: "Missing idempotency key." },
      400,
    );
  const category = String(body.category ?? "");
  if (!(CATEGORIES as readonly string[]).includes(category))
    return json({ error: "bad_request", message: "Pick a category." }, 400);
  const targetDollars = Number(body.target_dollars);
  if (!Number.isInteger(targetDollars) || targetDollars <= 0)
    return json(
      { error: "bad_request", message: "Bids are whole US dollars." },
      400,
    );
  const viewerId =
    typeof body.viewer_id === "string" &&
    /^[a-z0-9]{8,40}$/.test(body.viewer_id)
      ? body.viewer_id
      : null;

  // Double-submit / retry: return the same checkout instead of creating a second one.
  const replay = await env.DB.prepare(
    "SELECT * FROM bids WHERE idempotency_key = ?",
  )
    .bind(idempotencyKey)
    .first<BidRow>();
  if (replay) return replayCheckout(replay);

  let listing = normalizeListing(String(body.link ?? ""));
  if (isLinkError(listing))
    return json({ error: "invalid_link", message: listing.error }, 400);
  if (listing.resolve) {
    const resolved = await resolveShortLink(listing.link);
    if (!resolved)
      return json(
        {
          error: "invalid_link",
          message:
            "We couldn't follow that short link. Paste the final URL instead.",
        },
        400,
      );
    listing = resolved;
  }

  const priorRow = await env.DB.prepare(
    "SELECT COALESCE(SUM(charge_cents), 0) AS cents FROM bids WHERE environment = ? AND listing_key = ? AND status = 'paid'",
  )
    .bind(cfg.environment, listing.key)
    .first<{ cents: number }>();
  const priorCents = Number(priorRow?.cents ?? 0);
  const quote = quoteBid(targetDollars * 100, priorCents);
  if ("error" in quote)
    return json({ error: "invalid_amount", message: quote.error }, 400);

  const now = Date.now();
  const bidId = `bid_${randomHex(12)}`;
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO bids (id, idempotency_key, environment, listing_key, link, brand, category, prior_cents, target_cents,
                           charge_cents, currency, status, viewer_id, ip_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD', 'created', ?, ?, ?, ?)`,
      ).bind(
        bidId,
        idempotencyKey,
        cfg.environment,
        listing.key,
        listing.link,
        listing.brand,
        category,
        priorCents,
        targetDollars * 100,
        quote.chargeCents,
        viewerId,
        ipHash,
        now,
        now,
      ),
      env.DB.prepare(
        "INSERT INTO bid_transitions (bid_id, from_status, to_status, source, ref, at) VALUES (?, NULL, 'created', 'checkout', NULL, ?)",
      ).bind(bidId, now),
    ]);
  } catch (err) {
    // Lost a race with an identical submit: serve that one.
    const again = await env.DB.prepare(
      "SELECT * FROM bids WHERE idempotency_key = ?",
    )
      .bind(idempotencyKey)
      .first<BidRow>();
    if (again) return replayCheckout(again);
    throw err;
  }

  let session: { session_id: string; checkout_url?: string | null };
  try {
    session = await dodo(cfg).checkoutSessions.create(
      {
        product_cart: [
          {
            product_id: cfg.productId!,
            quantity: 1,
            amount: quote.chargeCents,
          },
        ],
        return_url: `${cfg.origin}/checkout/return?bid=${bidId}`,
        cancel_url: `${cfg.origin}/checkout/return?bid=${bidId}&cancelled=1`,
        metadata: {
          bid_id: bidId,
          listing_key: listing.key.slice(0, 200),
          environment: cfg.environment,
        },
        customization: { theme: "dark" },
        feature_flags: {
          allow_discount_code: false,
          allow_currency_selection: false,
          allow_tax_id: true,
        },
      },
      { idempotencyKey: bidId },
    );
    if (!session.checkout_url) throw new Error("Dodo returned no checkout_url");
  } catch (err) {
    await transition(
      env,
      bidId,
      ["created"],
      "error",
      "checkout",
      errMessage(err),
      { status_reason: errMessage(err) },
    );
    console.error(
      JSON.stringify({
        payments: "session_create_failed",
        bid: bidId,
        error: errMessage(err),
      }),
    );
    return json(
      {
        error: "checkout_unavailable",
        message:
          "Couldn't open checkout. Nothing was charged — try again in a moment.",
      },
      502,
    );
  }

  await transition(
    env,
    bidId,
    ["created"],
    "pending",
    "checkout",
    session.session_id,
    {
      checkout_session_id: session.session_id,
      checkout_url: session.checkout_url,
    },
  );
  return json({
    bid_id: bidId,
    checkout_url: session.checkout_url,
    charge_cents: quote.chargeCents,
    target_cents: targetDollars * 100,
    prior_cents: priorCents,
  });
}

function replayCheckout(bid: BidRow) {
  if (bid.status === "created" && Date.now() - bid.created_at < 60_000) {
    return json({ error: "checkout_opening", message: "Still opening checkout. Tap again in a moment.", bid_id: bid.id }, 409);
  }
  if (
    bid.status === "pending" &&
    bid.checkout_url &&
    Date.now() - bid.created_at < SESSION_TTL_MS
  ) {
    return json({
      bid_id: bid.id,
      checkout_url: bid.checkout_url,
      charge_cents: bid.charge_cents,
      target_cents: bid.target_cents,
      prior_cents: bid.prior_cents,
      replayed: true,
    });
  }
  if (bid.status === "paid")
    return json({ bid_id: bid.id, status: "paid", replayed: true });
  return json(
    {
      error: "checkout_closed",
      message: "That checkout already ended. Start a new bid.",
      bid_id: bid.id,
      status: bid.status,
    },
    409,
  );
}

/** Follow a known short link (max 5 hops, 3s each) to a real listing link. Fetch can only reach the public internet. */
async function resolveShortLink(start: string): Promise<ListingLink | null> {
  let current = start;
  for (let hop = 0; hop < 5; hop++) {
    let res: Response;
    try {
      res = await fetch(current, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(3000),
      });
    } catch {
      return null;
    }
    const location = res.headers.get("location");
    res.body?.cancel();
    if (res.status < 300 || res.status >= 400 || !location) return null;
    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      return null;
    }
    const listing = normalizeListing(next.toString());
    if (isLinkError(listing)) return null;
    if (!listing.resolve) return listing;
    current = listing.link;
  }
  return null;
}

// ── status (return page) ────────────────────────────────────────────────────

const PUBLIC_STATUS: Record<BidStatus, string> = {
  created: "confirming",
  pending: "confirming",
  paid: "paid",
  review: "review",
  failed: "failed",
  cancelled: "cancelled",
  expired: "expired",
  error: "failed",
  refunded: "refunded",
  disputed: "disputed",
  chargeback: "refunded",
};

async function checkoutStatus(url: URL, env: Env, ctx: Ctx, cfg: Config) {
  const bidId = url.searchParams.get("bid") || "";
  if (!/^bid_[0-9a-f]{24}$/.test(bidId))
    return json({ error: "bad_request" }, 400);
  let bid = await env.DB.prepare("SELECT * FROM bids WHERE id = ?")
    .bind(bidId)
    .first<BidRow>();
  if (!bid) return json({ error: "not_found" }, 404);

  // Don't wait on the webhook alone: ask Dodo directly, at most every 8s per bid.
  const now = Date.now();
  if (
    cfg.enabled &&
    bid.status === "pending" &&
    bid.checkout_session_id &&
    now - bid.created_at > 3_000
  ) {
    const claim = await env.DB.prepare(
      "UPDATE bids SET last_checked_at = ? WHERE id = ? AND status = 'pending' AND (last_checked_at IS NULL OR last_checked_at < ?)",
    )
      .bind(now, bidId, now - STATUS_CHECK_EVERY_MS)
      .run();
    if (claim.meta.changes > 0) {
      try {
        const changed = await syncFromDodo(env, cfg, bid, "status-check");
        if (changed) {
          ctx.waitUntil(purgeBoard(cfg));
          bid =
            (await env.DB.prepare("SELECT * FROM bids WHERE id = ?")
              .bind(bidId)
              .first<BidRow>()) ?? bid;
        }
      } catch (err) {
        console.error(
          JSON.stringify({
            payments: "status_check_failed",
            bid: bidId,
            error: errMessage(err),
          }),
        );
      }
    }
  }

  let rank: number | null = null;
  if (bid.status === "paid") {
    const entries = await queryBoard(env, cfg, "all", 1000);
    rank =
      entries.find((e) => e.key === bid!.listing_key)?.rank ??
      rankFor(bid.target_cents, entries, bid.listing_key);
  }

  return json({
    bid_id: bid.id,
    status: PUBLIC_STATUS[bid.status],
    brand: bid.brand,
    link: bid.link,
    charge_cents: bid.charge_cents,
    target_cents: bid.target_cents,
    paid_total: bid.paid_total,
    paid_tax: bid.paid_tax,
    paid_currency: bid.paid_currency,
    rank,
  });
}

/** Look up a pending bid's checkout session on Dodo and apply its payment if there is one. */
async function syncFromDodo(
  env: Env,
  cfg: Config,
  bid: BidRow,
  source: string,
): Promise<boolean> {
  if (!bid.checkout_session_id) return false;
  const client = dodo(cfg);
  const session = await client.checkoutSessions.retrieve(
    bid.checkout_session_id,
  );
  if (!session.payment_id) return false;
  const payment = await client.payments.retrieve(session.payment_id);
  const result = await applyPayment(
    env,
    cfg,
    payment,
    source,
    session.payment_id,
  );
  return result.outcome === "applied";
}

// ── state machine ───────────────────────────────────────────────────────────

type Settable = Partial<
  Pick<
    BidRow,
    | "checkout_session_id"
    | "checkout_url"
    | "payment_id"
    | "paid_currency"
    | "paid_total"
    | "paid_tax"
    | "status_reason"
    | "paid_at"
  >
> & { settlement_amount?: number | null; settlement_currency?: string | null };

const SETTABLE_COLUMNS = new Set([
  "checkout_session_id",
  "checkout_url",
  "payment_id",
  "paid_currency",
  "paid_total",
  "paid_tax",
  "status_reason",
  "paid_at",
  "settlement_amount",
  "settlement_currency",
]);

/** Guarded, atomic status change + audit row. Returns false if the bid wasn't in an allowed from-state. */
async function transition(
  env: Env,
  bidId: string,
  from: BidStatus[],
  to: BidStatus,
  source: string,
  ref: string | null,
  set: Settable = {},
) {
  const now = Date.now();
  const inList = from.map(() => "?").join(", ");
  const cols = Object.keys(set).filter((c) => SETTABLE_COLUMNS.has(c));
  const values = cols.map((c) => (set as Record<string, unknown>)[c] ?? null);

  const audit = env.DB.prepare(
    `INSERT INTO bid_transitions (bid_id, from_status, to_status, source, ref, at)
     SELECT id, status, ?, ?, ?, ? FROM bids WHERE id = ? AND status IN (${inList})`,
  ).bind(to, source, ref?.slice(0, 300) ?? null, now, bidId, ...from);
  const update = env.DB.prepare(
    `UPDATE bids SET status = ?, updated_at = ?${cols.map((c) => `, ${c} = ?`).join("")}
     WHERE id = ? AND status IN (${inList})`,
  ).bind(to, now, ...values, bidId, ...from);

  const [, result] = await env.DB.batch([audit, update]);
  return result.meta.changes > 0;
}

type ApplyResult = {
  outcome: "applied" | "ignored";
  detail: string;
  bidId?: string;
};

/** Apply an authoritative Dodo payment object to its bid. Idempotent. */
async function applyPayment(
  env: Env,
  cfg: Config,
  payment: Payment,
  source: string,
  ref: string,
): Promise<ApplyResult> {
  const bidId =
    typeof payment.metadata?.bid_id === "string" ? payment.metadata.bid_id : "";
  if (!/^bid_[0-9a-f]{24}$/.test(bidId))
    return { outcome: "ignored", detail: "payment has no bid_id metadata" };
  if (cfg.businessId && payment.business_id !== cfg.businessId)
    return { outcome: "ignored", detail: "business_id mismatch", bidId };

  const bid = await env.DB.prepare("SELECT * FROM bids WHERE id = ?")
    .bind(bidId)
    .first<BidRow>();
  if (!bid) return { outcome: "ignored", detail: "unknown bid", bidId };
  if (bid.environment !== cfg.environment)
    return { outcome: "ignored", detail: "environment mismatch", bidId };

  if (payment.status === "succeeded") {
    if (bid.status === "paid" && bid.payment_id === payment.payment_id)
      return { outcome: "ignored", detail: "already paid", bidId };

    const problems: string[] = [];
    if (bid.payment_id && bid.payment_id !== payment.payment_id)
      problems.push(`bid already has payment ${bid.payment_id}`);
    if (
      bid.checkout_session_id &&
      payment.checkout_session_id &&
      payment.checkout_session_id !== bid.checkout_session_id
    )
      problems.push("checkout session mismatch");
    if (
      payment.product_cart &&
      !payment.product_cart.some((p) => p.product_id === cfg.productId)
    )
      problems.push("product mismatch");
    if (payment.currency !== bid.currency)
      problems.push(`currency ${payment.currency} != ${bid.currency}`);
    else if (payment.total_amount - (payment.tax ?? 0) !== bid.charge_cents)
      problems.push(
        `pre-tax ${payment.total_amount - (payment.tax ?? 0)} != ${bid.charge_cents}`,
      );

    const to: BidStatus = problems.length ? "review" : "paid";
    const changed = await transition(
      env,
      bid.id,
      ["created", "pending", "failed", "cancelled", "expired", "error"],
      to,
      source,
      ref,
      {
        payment_id: payment.payment_id,
        paid_currency: payment.currency,
        paid_total: payment.total_amount,
        paid_tax: payment.tax ?? null,
        settlement_amount: payment.settlement_amount,
        settlement_currency: payment.settlement_currency,
        paid_at: to === "paid" ? Date.now() : null,
        status_reason: problems.join("; ") || null,
      },
    );
    if (to === "review")
      console.error(
        JSON.stringify({
          payments: "held_for_review",
          bid: bid.id,
          payment: payment.payment_id,
          problems,
        }),
      );
    return {
      outcome: changed ? "applied" : "ignored",
      detail: changed ? `→ ${to}` : `no transition from ${bid.status}`,
      bidId,
    };
  }

  if (payment.status === "failed" || payment.status === "cancelled") {
    const changed = await transition(
      env,
      bid.id,
      ["created", "pending"],
      payment.status,
      source,
      ref,
      {
        status_reason: payment.error_message || payment.error_code || null,
      },
    );
    return {
      outcome: changed ? "applied" : "ignored",
      detail: changed
        ? `→ ${payment.status}`
        : `no transition from ${bid.status}`,
      bidId,
    };
  }

  return {
    outcome: "ignored",
    detail: `payment status ${payment.status ?? "unknown"}`,
    bidId,
  };
}

// ── webhook ─────────────────────────────────────────────────────────────────

async function dodoWebhook(request: Request, env: Env, ctx: Ctx, cfg: Config) {
  if (!cfg.enabled) return json({ error: "payments_disabled" }, 503);

  const len = Number(request.headers.get("content-length") || 0);
  if (len > 512_000) return json({ error: "too_large" }, 413);
  const raw = await request.text();
  if (raw.length > 512_000) return json({ error: "too_large" }, 413);

  const headers = {
    "webhook-id": request.headers.get("webhook-id") || "",
    "webhook-signature": request.headers.get("webhook-signature") || "",
    "webhook-timestamp": request.headers.get("webhook-timestamp") || "",
  };
  if (
    !headers["webhook-id"] ||
    !headers["webhook-signature"] ||
    !headers["webhook-timestamp"]
  )
    return json({ error: "missing_signature" }, 400);

  let event: {
    type: string;
    business_id?: string;
    data: Record<string, unknown>;
  };
  try {
    // Standard Webhooks: HMAC-SHA256 over id.timestamp.body, constant-time compare, 5-minute timestamp tolerance.
    event = dodo(cfg).webhooks.unwrap(raw, {
      headers,
      key: cfg.webhookKey,
    }) as unknown as typeof event;
  } catch {
    return json({ error: "invalid_signature" }, 401);
  }

  const webhookId = headers["webhook-id"].slice(0, 200);
  const now = Date.now();
  const paymentId =
    typeof event.data?.payment_id === "string" ? event.data.payment_id : null;

  const seen = await env.DB.prepare(
    "SELECT outcome FROM payment_events WHERE webhook_id = ?",
  )
    .bind(webhookId)
    .first<{ outcome: string }>();
  if (seen && (seen.outcome === "applied" || seen.outcome === "ignored")) {
    await env.DB.prepare(
      "UPDATE payment_events SET attempts = attempts + 1 WHERE webhook_id = ?",
    )
      .bind(webhookId)
      .run();
    return json({ ok: true, duplicate: true });
  }
  if (seen) {
    await env.DB.prepare(
      "UPDATE payment_events SET attempts = attempts + 1, outcome = 'received' WHERE webhook_id = ?",
    )
      .bind(webhookId)
      .run();
  } else {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO payment_events (webhook_id, type, payment_id, outcome, payload, received_at) VALUES (?, ?, ?, 'received', ?, ?)",
    )
      .bind(webhookId, String(event.type).slice(0, 80), paymentId, raw, now)
      .run();
  }

  let result: ApplyResult;
  try {
    if (
      cfg.businessId &&
      event.business_id &&
      event.business_id !== cfg.businessId
    ) {
      result = { outcome: "ignored", detail: "business_id mismatch" };
    } else {
      result = await routeEvent(env, cfg, event, webhookId);
    }
  } catch (err) {
    await env.DB.prepare(
      "UPDATE payment_events SET outcome = 'error', detail = ?, processed_at = ? WHERE webhook_id = ?",
    )
      .bind(errMessage(err), Date.now(), webhookId)
      .run();
    console.error(
      JSON.stringify({
        payments: "webhook_failed",
        webhook: webhookId,
        type: event.type,
        error: errMessage(err),
      }),
    );
    return json({ error: "processing_failed" }, 500); // Dodo retries with backoff
  }

  await env.DB.prepare(
    "UPDATE payment_events SET outcome = ?, detail = ?, bid_id = ?, processed_at = ? WHERE webhook_id = ?",
  )
    .bind(
      result.outcome,
      result.detail.slice(0, 300),
      result.bidId ?? null,
      Date.now(),
      webhookId,
    )
    .run();
  if (result.outcome === "applied") ctx.waitUntil(purgeBoard(cfg));
  return json({ ok: true, outcome: result.outcome });
}

async function routeEvent(
  env: Env,
  cfg: Config,
  event: { type: string; data: Record<string, unknown> },
  webhookId: string,
): Promise<ApplyResult> {
  const data = event.data || {};
  const paymentId = typeof data.payment_id === "string" ? data.payment_id : "";

  switch (event.type) {
    case "payment.succeeded":
    case "payment.failed":
    case "payment.cancelled": {
      if (!paymentId) return { outcome: "ignored", detail: "no payment_id" };
      // Never trust the webhook body for money: re-read the payment from the Dodo API.
      const payment = await dodo(cfg).payments.retrieve(paymentId);
      return applyPayment(env, cfg, payment, "webhook", webhookId);
    }
    case "payment.processing":
      return { outcome: "ignored", detail: "processing" };

    case "refund.succeeded": {
      const bid = await bidByPayment(env, paymentId);
      if (!bid)
        return { outcome: "ignored", detail: "refund for unknown payment" };
      const changed = await transition(
        env,
        bid.id,
        ["paid", "review", "disputed"],
        "refunded",
        "webhook",
        webhookId,
        {
          status_reason:
            `refund ${String(data.refund_id ?? "")} ${data.is_partial ? "(partial)" : ""} ${String(data.amount ?? "")}`.trim(),
        },
      );
      return {
        outcome: changed ? "applied" : "ignored",
        detail: changed ? "→ refunded" : `no transition from ${bid.status}`,
        bidId: bid.id,
      };
    }

    case "dispute.opened":
    case "dispute.challenged": {
      const bid = await bidByPayment(env, paymentId);
      if (!bid)
        return { outcome: "ignored", detail: "dispute for unknown payment" };
      const changed = await transition(
        env,
        bid.id,
        ["paid"],
        "disputed",
        "webhook",
        webhookId,
        { status_reason: `dispute ${String(data.dispute_id ?? "")}` },
      );
      return {
        outcome: changed ? "applied" : "ignored",
        detail: changed ? "→ disputed" : `no transition from ${bid.status}`,
        bidId: bid.id,
      };
    }
    case "dispute.won":
    case "dispute.cancelled":
    case "dispute.expired": {
      const bid = await bidByPayment(env, paymentId);
      if (!bid)
        return { outcome: "ignored", detail: "dispute for unknown payment" };
      const changed = await transition(
        env,
        bid.id,
        ["disputed"],
        "paid",
        "webhook",
        webhookId,
        { status_reason: `dispute ${event.type.split(".")[1]}` },
      );
      return {
        outcome: changed ? "applied" : "ignored",
        detail: changed ? "→ paid" : `no transition from ${bid.status}`,
        bidId: bid.id,
      };
    }
    case "dispute.lost":
    case "dispute.accepted": {
      const bid = await bidByPayment(env, paymentId);
      if (!bid)
        return { outcome: "ignored", detail: "dispute for unknown payment" };
      const changed = await transition(
        env,
        bid.id,
        ["paid", "disputed", "review"],
        "chargeback",
        "webhook",
        webhookId,
        { status_reason: `dispute ${event.type.split(".")[1]}` },
      );
      return {
        outcome: changed ? "applied" : "ignored",
        detail: changed ? "→ chargeback" : `no transition from ${bid.status}`,
        bidId: bid.id,
      };
    }
  }
  return { outcome: "ignored", detail: `unhandled type ${event.type}` };
}

async function bidByPayment(env: Env, paymentId: string) {
  if (!paymentId) return null;
  return env.DB.prepare("SELECT * FROM bids WHERE payment_id = ?")
    .bind(paymentId)
    .first<BidRow>();
}

// ── cron: reconcile ─────────────────────────────────────────────────────────

/** Hourly safety net: settle pending bids whose webhook never arrived, expire abandoned ones. */
export async function reconcilePayments(env: Env) {
  const cfg = config(env);
  if (!cfg.enabled) return { skipped: "payments disabled" };
  const now = Date.now();
  let checked = 0,
    applied = 0,
    expired = 0,
    errored = 0;

  // Rows that never got a checkout session (crash between insert and Dodo call).
  const stuck = await env.DB.prepare(
    "SELECT id FROM bids WHERE status = 'created' AND created_at < ? LIMIT 50",
  )
    .bind(now - 10 * 60_000)
    .all<{ id: string }>();
  for (const r of stuck.results) {
    if (
      await transition(
        env,
        r.id,
        ["created"],
        "error",
        "reconcile",
        "no checkout session created",
        { status_reason: "no checkout session created" },
      )
    )
      errored++;
  }

  const pending = await env.DB.prepare(
    "SELECT * FROM bids WHERE status = 'pending' AND environment = ? AND created_at < ? ORDER BY created_at ASC LIMIT 40",
  )
    .bind(cfg.environment, now - 2 * 60_000)
    .all<BidRow>();
  for (const bid of pending.results) {
    checked++;
    try {
      if (await syncFromDodo(env, cfg, bid, "reconcile")) {
        applied++;
        continue;
      }
    } catch (err) {
      console.error(
        JSON.stringify({
          payments: "reconcile_check_failed",
          bid: bid.id,
          error: errMessage(err),
        }),
      );
      continue; // try again next hour; never expire a bid we couldn't check
    }
    if (now - bid.created_at > PENDING_EXPIRE_MS) {
      if (
        await transition(
          env,
          bid.id,
          ["pending"],
          "expired",
          "reconcile",
          "checkout session expired",
          { status_reason: "checkout session expired" },
        )
      )
        expired++;
    }
  }

  if (applied || expired) await purgeBoard(cfg);
  return { checked, applied, expired, errored };
}
