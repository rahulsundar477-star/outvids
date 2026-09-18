/**
 * End-to-end tests for server/payments.ts against a real SQLite database (the D1 migrations),
 * real webhook signature verification, and a mocked Dodo network. No production data is touched.
 * Run: npm run test:payments
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { Webhook } from "standardwebhooks";
import { handlePayments, reconcilePayments } from "../server/payments";
import { dodoState } from "./dodo-mock";

// ── D1 shim over node:sqlite ────────────────────────────────────────────────
function d1(db: DatabaseSync) {
  class Stmt {
    constructor(
      public sql: string,
      public args: unknown[] = [],
    ) {}
    bind(...args: unknown[]) {
      return new Stmt(this.sql, args);
    }
    private exec() {
      const s = db.prepare(this.sql);
      if (/^\s*(select|with)/i.test(this.sql))
        return {
          rows: s.all(...(this.args as never[])) as Record<string, unknown>[],
          changes: 0,
        };
      const r = s.run(...(this.args as never[]));
      return { rows: [], changes: Number(r.changes) };
    }
    async first<T>() {
      return (this.exec().rows[0] as T) ?? null;
    }
    async all<T>() {
      return { results: this.exec().rows as T[], success: true, meta: {} };
    }
    async run() {
      return { success: true, meta: { changes: this.exec().changes } };
    }
    _batchRun() {
      const r = this.exec();
      return { results: r.rows, success: true, meta: { changes: r.changes } };
    }
  }
  return {
    prepare: (sql: string) => new Stmt(sql),
    async batch(stmts: Stmt[]) {
      db.exec("BEGIN");
      try {
        const out = stmts.map((s) => s._batchRun());
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
}

// ── harness ─────────────────────────────────────────────────────────────────
const cacheStore = new Map<string, Response>();
(globalThis as unknown as { caches: unknown }).caches = {
  default: {
    async match(k: string | Request) {
      const r = cacheStore.get(typeof k === "string" ? k : k.url);
      return r?.clone();
    },
    async put(k: string | Request, r: Response) {
      cacheStore.set(typeof k === "string" ? k : k.url, r.clone());
    },
    async delete(k: string | Request) {
      return cacheStore.delete(typeof k === "string" ? k : k.url);
    },
  },
};

const WEBHOOK_SECRET =
  "whsec_" +
  Buffer.from("outvids-test-webhook-secret-32bytes!!").toString("base64");
const PRODUCT = "pdt_outbid_test";
const ORIGIN = "https://outvids.lol";

function makeEnv(overrides: Record<string, unknown> = {}) {
  const db = new DatabaseSync(":memory:");
  for (const f of ["migrations/0001_init.sql", "migrations/0002_payments.sql"])
    db.exec(readFileSync(f, "utf8"));
  let limited = false;
  const env = {
    DB: d1(db),
    PUBLIC_ORIGIN: ORIGIN,
    DODO_ENVIRONMENT: "test_mode",
    DODO_PAYMENTS_API_KEY: "sk_test_mock",
    DODO_PAYMENTS_WEBHOOK_KEY: WEBHOOK_SECRET,
    DODO_BID_PRODUCT_ID: PRODUCT,
    DODO_BUSINESS_ID: "bus_outvids",
    CHECKOUT_RL: { limit: async () => ({ success: !limited }) },
    ...overrides,
  } as unknown as CloudflareEnv;
  return { env, db, setLimited: (v: boolean) => (limited = v) };
}

const waits: Promise<unknown>[] = [];
const ctx = {
  waitUntil: (p: Promise<unknown>) => waits.push(p),
  passThroughOnException() {},
} as unknown as ExecutionContext;

async function call(
  env: CloudflareEnv,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const init: RequestInit = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
    (init.headers as Record<string, string>)["content-type"] ??=
      "application/json";
  }
  const res = await handlePayments(new Request(ORIGIN + path, init), env, ctx);
  await Promise.all(waits.splice(0));
  const text = await res.text();
  let json: Record<string, any> = {};
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json };
}

const checkout = (
  env: CloudflareEnv,
  body: Record<string, unknown>,
  origin = ORIGIN,
) =>
  call(env, "POST", "/api/checkout", body, {
    origin,
    "cf-connecting-ip": "203.0.113.7",
  });

let wh = 0;
function signedWebhook(
  env: CloudflareEnv,
  event: Record<string, unknown>,
  opts: { id?: string; secret?: string; tamper?: boolean } = {},
) {
  const id = opts.id ?? `msg_${++wh}`;
  const ts = new Date();
  const payload = JSON.stringify(event);
  const signature = new Webhook(opts.secret ?? WEBHOOK_SECRET).sign(
    id,
    ts,
    payload,
  );
  const body = opts.tamper
    ? payload.replace(/"total_amount":\d+/, '"total_amount":1')
    : payload;
  return call(env, "POST", "/api/webhooks/dodo", body, {
    "webhook-id": id,
    "webhook-timestamp": String(Math.floor(ts.getTime() / 1000)),
    "webhook-signature": signature,
    "content-type": "application/json",
  });
}

function payment(
  bidId: string,
  sessionId: string,
  over: Record<string, unknown> = {},
) {
  const charge = Number(over.__charge ?? 1000);
  const tax = Number(over.__tax ?? 180);
  const p = {
    payment_id: `pay_${bidId.slice(4, 12)}_${Math.random().toString(36).slice(2, 6)}`,
    business_id: "bus_outvids",
    status: "succeeded",
    currency: "USD",
    total_amount: charge + tax,
    tax,
    settlement_amount: charge,
    settlement_currency: "USD",
    checkout_session_id: sessionId,
    product_cart: [{ product_id: PRODUCT, quantity: 1 }],
    metadata: { bid_id: bidId },
    error_code: null,
    error_message: null,
    created_at: new Date().toISOString(),
    ...over,
  };
  delete (p as Record<string, unknown>).__charge;
  delete (p as Record<string, unknown>).__tax;
  return p;
}

const bidRow = (db: DatabaseSync, id: string) =>
  db.prepare("SELECT * FROM bids WHERE id = ?").get(id) as Record<string, any>;
const count = (db: DatabaseSync, sql: string, ...a: unknown[]) =>
  Number((db.prepare(sql).get(...(a as never[])) as { n: number }).n);
const board = async (env: CloudflareEnv, range = "all") => {
  cacheStore.clear();
  return (await call(env, "GET", `/api/board?range=${range}`)).json;
};

// ── tiny runner ─────────────────────────────────────────────────────────────
const results: { name: string; ok: boolean; err?: string }[] = [];
function eq(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
}
async function test(name: string, fn: () => Promise<void>) {
  dodoState.reset();
  cacheStore.clear();
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (e) {
    results.push({
      name,
      ok: false,
      err: (e as Error).stack?.split("\n").slice(0, 3).join(" | "),
    });
  }
}

let keyN = 0;
const key = () => `test-idem-key-${String(++keyN).padStart(6, "0")}`;

async function paidBid(env: CloudflareEnv, link: string, dollars: number) {
  const r = await checkout(env, {
    link,
    category: "AI",
    target_dollars: dollars,
    idempotency_key: key(),
  });
  eq(r.status, 200, `checkout ${link} $${dollars}`);
  const sessionId = [...dodoState.sessions.keys()].at(-1)!;
  const p = payment(r.json.bid_id, sessionId, {
    __charge: r.json.charge_cents,
  });
  dodoState.payments.set(p.payment_id, p);
  dodoState.sessions.set(sessionId, {
    payment_id: p.payment_id,
    payment_status: "succeeded",
  });
  const w = await signedWebhook(env, {
    business_id: "bus_outvids",
    type: "payment.succeeded",
    timestamp: new Date().toISOString(),
    data: p,
  });
  eq(w.json.outcome, "applied", "webhook applied");
  return { bidId: r.json.bid_id as string, payment: p, sessionId };
}

// ── tests ───────────────────────────────────────────────────────────────────
await test("disabled without keys: checkout 503 with no-charge copy, board says enabled:false", async () => {
  const { env } = makeEnv({
    DODO_PAYMENTS_API_KEY: undefined,
    DODO_BID_PRODUCT_ID: "",
  });
  const r = await checkout(env, {
    link: "acme.com",
    category: "AI",
    target_dollars: 10,
    idempotency_key: key(),
  });
  eq(r.status, 503, "status");
  eq(r.json.error, "checkout_disabled", "error");
  eq(
    /nothing was charged/i.test(r.json.message),
    true,
    "copy says nothing was charged",
  );
  eq((await board(env)).enabled, false, "board.enabled");
  eq(
    (await signedWebhook(env, { type: "payment.succeeded", data: {} })).status,
    503,
    "webhook disabled",
  );
});

await test("rejects cross-origin, non-JSON, rate-limited requests", async () => {
  const { env, setLimited } = makeEnv();
  eq(
    (await checkout(env, { link: "acme.com" }, "https://evil.example")).status,
    403,
    "bad origin",
  );
  eq(
    (
      await call(env, "POST", "/api/checkout", "link=acme.com", {
        origin: ORIGIN,
        "content-type": "application/x-www-form-urlencoded",
      })
    ).status,
    415,
    "form post",
  );
  setLimited(true);
  eq(
    (
      await checkout(env, {
        link: "acme.com",
        category: "AI",
        target_dollars: 10,
        idempotency_key: key(),
      })
    ).status,
    429,
    "rate limited",
  );
});

await test("validates link, category and amount server-side", async () => {
  const { env, db } = makeEnv();
  const bad = async (body: Record<string, unknown>) =>
    (
      await checkout(env, {
        category: "AI",
        target_dollars: 10,
        link: "acme.com",
        idempotency_key: key(),
        ...body,
      })
    ).status;
  eq(await bad({ link: "https://t.me/joinchat/abc" }), 400, "chat link");
  eq(await bad({ link: "onlyfans.com/someone" }), 400, "adult link");
  eq(await bad({ link: "http://192.168.1.1/admin" }), 400, "ip link");
  eq(await bad({ target_dollars: 9 }), 400, "under $10");
  eq(await bad({ target_dollars: 10.5 }), 400, "cents");
  eq(await bad({ target_dollars: 1_000_000 }), 400, "over max");
  eq(await bad({ category: "Gambling" }), 400, "unknown category");
  eq(await bad({ idempotency_key: "short" }), 400, "bad idempotency key");
  eq(
    count(db, "SELECT COUNT(*) n FROM bids"),
    0,
    "no rows written for invalid requests",
  );
  eq(dodoState.sessionsCreated.length, 0, "Dodo never called");
});

await test("happy path: bid row before Dodo, server-computed charge, metadata + no discounts", async () => {
  const { env, db } = makeEnv();
  const r = await checkout(env, {
    link: "https://www.Acme.com/?utm_source=x#top",
    category: "SaaS",
    target_dollars: 250,
    idempotency_key: key(),
    viewer_id: "abcdefgh1234",
  });
  eq(r.status, 200, "status");
  eq(r.json.charge_cents, 25000, "charge");
  const row = bidRow(db, r.json.bid_id);
  eq(
    [row.status, row.listing_key, row.link, row.charge_cents, row.environment],
    ["pending", "acme.com", "https://acme.com", 25000, "test_mode"],
    "bid row",
  );
  const sent = dodoState.sessionsCreated[0];
  eq(
    (sent.body.product_cart as any)[0],
    { product_id: PRODUCT, quantity: 1, amount: 25000 },
    "cart",
  );
  eq((sent.body.metadata as any).bid_id, r.json.bid_id, "metadata bid_id");
  eq(
    (sent.body.feature_flags as any).allow_discount_code,
    false,
    "discounts off",
  );
  eq(sent.idempotencyKey, r.json.bid_id, "Dodo idempotency key");
  eq(
    count(
      db,
      "SELECT COUNT(*) n FROM bid_transitions WHERE bid_id = ?",
      r.json.bid_id,
    ),
    2,
    "audit: created + pending",
  );
});

await test("double submit with the same key returns the same checkout, one bid, one session", async () => {
  const { env, db } = makeEnv();
  const k = key();
  const body = {
    link: "acme.com",
    category: "AI",
    target_dollars: 40,
    idempotency_key: k,
  };
  const [a, b] = await Promise.all([checkout(env, body), checkout(env, body)]);
  const c = await checkout(env, body);
  const urls = [a, b, c]
    .filter((x) => x.status === 200)
    .map((x) => x.json.checkout_url);
  eq(new Set(urls).size, 1, "one checkout url");
  eq(count(db, "SELECT COUNT(*) n FROM bids"), 1, "one bid row");
  eq(
    new Set(dodoState.sessionsCreated.map((s) => s.idempotencyKey)).size,
    1,
    "one Dodo idempotency key",
  );
});

await test("Dodo outage when opening checkout: 502, bid marked error, nothing on board", async () => {
  const { env, db } = makeEnv();
  dodoState.failCreate = true;
  const r = await checkout(env, {
    link: "acme.com",
    category: "AI",
    target_dollars: 10,
    idempotency_key: key(),
  });
  eq(r.status, 502, "status");
  eq(/nothing was charged/i.test(r.json.message), true, "copy");
  eq(
    bidRow(db, db.prepare("SELECT id FROM bids").get()!.id as string).status,
    "error",
    "bid status",
  );
  eq((await board(env)).entries.length, 0, "board empty");
});

await test("webhook: forged or tampered signatures are rejected and not stored", async () => {
  const { env, db } = makeEnv();
  const ev = {
    type: "payment.succeeded",
    data: { payment_id: "pay_x", total_amount: 99999 },
  };
  eq(
    (
      await signedWebhook(env, ev, {
        secret:
          "whsec_" +
          Buffer.from("attacker-secret-attacker-secret!").toString("base64"),
      })
    ).status,
    401,
    "wrong secret",
  );
  eq(
    (await signedWebhook(env, ev, { tamper: true })).status,
    401,
    "tampered body",
  );
  eq(
    (await call(env, "POST", "/api/webhooks/dodo", JSON.stringify(ev))).status,
    400,
    "no headers",
  );
  eq(count(db, "SELECT COUNT(*) n FROM payment_events"), 0, "nothing stored");
});

await test("paid webhook → bid paid, board shows it, tax recorded; replays never double count", async () => {
  const { env, db } = makeEnv();
  const { bidId, payment: p } = await paidBid(env, "acme.com", 10);
  const row = bidRow(db, bidId);
  eq(
    [row.status, row.paid_total, row.paid_tax, row.payment_id],
    ["paid", 1180, 180, p.payment_id],
    "paid row",
  );
  const b = await board(env);
  eq(
    b.entries.map((e: any) => [e.rank, e.key, e.total_cents]),
    [[1, "acme.com", 1000]],
    "board",
  );

  // Same delivery again (same webhook-id) and a re-sent event (new id): both no-ops.
  const ev = { business_id: "bus_outvids", type: "payment.succeeded", data: p };
  const again = await signedWebhook(env, ev, { id: "msg_dupe" });
  const dupe = await signedWebhook(env, ev, { id: "msg_dupe" });
  eq([again.json.outcome, dupe.json.duplicate], ["ignored", true], "replays");
  eq((await board(env)).entries[0].total_cents, 1000, "still $10");
  eq(
    count(
      db,
      "SELECT attempts n FROM payment_events WHERE webhook_id = 'msg_dupe'",
    ),
    2,
    "attempts counted",
  );
});

await test("raise: same link pays only the difference; board total adds up", async () => {
  const { env, db } = makeEnv();
  await paidBid(env, "acme.com", 10);
  const r = await checkout(env, {
    link: "https://acme.com/",
    category: "AI",
    target_dollars: 25,
    idempotency_key: key(),
  });
  eq([r.json.prior_cents, r.json.charge_cents], [1000, 1500], "difference");
  eq(
    (
      await checkout(env, {
        link: "acme.com",
        category: "AI",
        target_dollars: 10,
        idempotency_key: key(),
      })
    ).status,
    400,
    "raise must be +$1",
  );
  const sessionId = [...dodoState.sessions.keys()].at(-1)!;
  const p = payment(r.json.bid_id, sessionId, { __charge: 1500 });
  dodoState.payments.set(p.payment_id, p);
  await signedWebhook(env, {
    business_id: "bus_outvids",
    type: "payment.succeeded",
    data: p,
  });
  eq((await board(env)).entries[0].total_cents, 2500, "total $25");
  eq(
    count(db, "SELECT COUNT(*) n FROM bids WHERE status = 'paid'"),
    2,
    "two paid bids",
  );
});

await test("ranking: higher total first, ties go to the older listing, Today board separate", async () => {
  const { env, db } = makeEnv();
  await paidBid(env, "older.com", 50);
  await paidBid(env, "newer.com", 50);
  await paidBid(env, "top.com", 60);
  eq(
    (await board(env)).entries.map((e: any) => e.key),
    ["top.com", "older.com", "newer.com"],
    "order",
  );
  db.prepare(
    "UPDATE bids SET paid_at = paid_at - 2*86400000 WHERE listing_key = 'top.com'",
  ).run();
  eq(
    (await board(env, "today")).entries.map((e: any) => e.key),
    ["older.com", "newer.com"],
    "today excludes old payments",
  );
});

await test("mismatches go to review, never the board: amount, currency, session, product", async () => {
  const { env, db } = makeEnv();
  const cases: [string, Record<string, unknown>][] = [
    ["amount", { __charge: 900 }],
    ["currency", { currency: "EUR" }],
    ["session", { checkout_session_id: "cks_someone_else" }],
    ["product", { product_cart: [{ product_id: "pdt_other", quantity: 1 }] }],
  ];
  for (const [label, over] of cases) {
    const r = await checkout(env, {
      link: `${label}.com`,
      category: "AI",
      target_dollars: 10,
      idempotency_key: key(),
    });
    const sessionId = [...dodoState.sessions.keys()].at(-1)!;
    const p = payment(r.json.bid_id, sessionId, over);
    dodoState.payments.set(p.payment_id, p);
    await signedWebhook(env, {
      business_id: "bus_outvids",
      type: "payment.succeeded",
      data: p,
    });
    eq(bidRow(db, r.json.bid_id).status, "review", `${label} → review`);
  }
  eq((await board(env)).entries.length, 0, "nothing on board");
});

await test("webhook body is never trusted: the API copy decides", async () => {
  const { env, db } = makeEnv();
  const r = await checkout(env, {
    link: "acme.com",
    category: "AI",
    target_dollars: 10,
    idempotency_key: key(),
  });
  const sessionId = [...dodoState.sessions.keys()].at(-1)!;
  const real = payment(r.json.bid_id, sessionId, {
    status: "failed",
    error_message: "card declined",
  });
  dodoState.payments.set(real.payment_id, real);
  // Signed event claims success, but the API says failed.
  await signedWebhook(env, {
    business_id: "bus_outvids",
    type: "payment.succeeded",
    data: { ...real, status: "succeeded" },
  });
  eq(bidRow(db, r.json.bid_id).status, "failed", "follows API");
});

await test("other businesses' and test-vs-live events are ignored", async () => {
  const { env, db } = makeEnv();
  const r = await checkout(env, {
    link: "acme.com",
    category: "AI",
    target_dollars: 10,
    idempotency_key: key(),
  });
  const sessionId = [...dodoState.sessions.keys()].at(-1)!;
  const p = payment(r.json.bid_id, sessionId, { business_id: "bus_other" });
  dodoState.payments.set(p.payment_id, p);
  const w = await signedWebhook(env, {
    business_id: "bus_other",
    type: "payment.succeeded",
    data: p,
  });
  eq(
    [w.json.outcome, bidRow(db, r.json.bid_id).status],
    ["ignored", "pending"],
    "other business",
  );

  const live = makeEnv({ DODO_ENVIRONMENT: "live_mode" });
  // A live-mode server never credits a test-mode bid.
  live.db.exec(
    `INSERT INTO bids SELECT * FROM (SELECT 'bid_aaaaaaaaaaaaaaaaaaaaaaaa','k-test-000000000001','test_mode','x.com/a','https://x.com/a','@a','AI',0,1000,1000,'USD','pending',NULL,NULL,NULL,'cks_t',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,NULL,NULL)`,
  );
  const lp = payment("bid_aaaaaaaaaaaaaaaaaaaaaaaa", "cks_t");
  dodoState.payments.set(lp.payment_id, lp);
  const lw = await signedWebhook(live.env, {
    business_id: "bus_outvids",
    type: "payment.succeeded",
    data: lp,
  });
  eq(lw.json.outcome, "ignored", "environment mismatch ignored");
});

await test("webhook processing error → 500 (Dodo retries) → retry applies exactly once", async () => {
  const { env, db } = makeEnv();
  const r = await checkout(env, {
    link: "acme.com",
    category: "AI",
    target_dollars: 10,
    idempotency_key: key(),
  });
  const sessionId = [...dodoState.sessions.keys()].at(-1)!;
  const p = payment(r.json.bid_id, sessionId);
  dodoState.payments.set(p.payment_id, p);
  dodoState.failRetrieve = 1;
  const ev = { business_id: "bus_outvids", type: "payment.succeeded", data: p };
  const first = await signedWebhook(env, ev, { id: "msg_retry" });
  eq(
    [first.status, bidRow(db, r.json.bid_id).status],
    [500, "pending"],
    "first attempt fails safely",
  );
  const retry = await signedWebhook(env, ev, { id: "msg_retry" });
  eq(
    [retry.status, retry.json.outcome, bidRow(db, r.json.bid_id).status],
    [200, "applied", "paid"],
    "retry applies",
  );
  eq(
    count(
      db,
      "SELECT COUNT(*) n FROM bid_transitions WHERE bid_id = ? AND to_status = 'paid'",
      r.json.bid_id,
    ),
    1,
    "one paid transition",
  );
});

await test("failed / cancelled payments close the bid; a later success still wins", async () => {
  const { env, db } = makeEnv();
  const r = await checkout(env, {
    link: "acme.com",
    category: "AI",
    target_dollars: 10,
    idempotency_key: key(),
  });
  const sessionId = [...dodoState.sessions.keys()].at(-1)!;
  const failed = payment(r.json.bid_id, sessionId, {
    status: "failed",
    error_message: "insufficient funds",
  });
  dodoState.payments.set(failed.payment_id, failed);
  await signedWebhook(env, {
    business_id: "bus_outvids",
    type: "payment.failed",
    data: failed,
  });
  eq(bidRow(db, r.json.bid_id).status, "failed", "failed");
  const ok = payment(r.json.bid_id, sessionId);
  dodoState.payments.set(ok.payment_id, ok);
  await signedWebhook(env, {
    business_id: "bus_outvids",
    type: "payment.succeeded",
    data: ok,
  });
  eq(
    bidRow(db, r.json.bid_id).status,
    "paid",
    "retry on same checkout succeeded",
  );
});

await test("refund and chargeback take the listing off the board; won dispute puts it back", async () => {
  const { env, db } = makeEnv();
  const a = await paidBid(env, "refund.com", 10);
  const b = await paidBid(env, "dispute.com", 20);
  await signedWebhook(env, {
    business_id: "bus_outvids",
    type: "refund.succeeded",
    data: {
      refund_id: "rfd_1",
      payment_id: a.payment.payment_id,
      is_partial: false,
      amount: 1180,
    },
  });
  eq(bidRow(db, a.bidId).status, "refunded", "refunded");
  await signedWebhook(env, {
    business_id: "bus_outvids",
    type: "dispute.opened",
    data: { dispute_id: "dsp_1", payment_id: b.payment.payment_id },
  });
  eq((await board(env)).entries.length, 0, "both off the board");
  await signedWebhook(env, {
    business_id: "bus_outvids",
    type: "dispute.won",
    data: { dispute_id: "dsp_1", payment_id: b.payment.payment_id },
  });
  eq(
    (await board(env)).entries.map((e: any) => e.key),
    ["dispute.com"],
    "won dispute restored",
  );
  await signedWebhook(env, {
    business_id: "bus_outvids",
    type: "dispute.lost",
    data: { dispute_id: "dsp_2", payment_id: b.payment.payment_id },
  });
  eq(
    [bidRow(db, b.bidId).status, (await board(env)).entries.length],
    ["chargeback", 0],
    "chargeback removes",
  );
});

await test("return page never trusts ?status: missing webhook is recovered by server-side check", async () => {
  const { env, db } = makeEnv();
  const r = await checkout(env, {
    link: "acme.com",
    category: "AI",
    target_dollars: 10,
    idempotency_key: key(),
  });
  const sessionId = [...dodoState.sessions.keys()].at(-1)!;
  db.prepare(
    "UPDATE bids SET created_at = created_at - 10000 WHERE id = ?",
  ).run(r.json.bid_id);
  eq(
    (await call(env, "GET", `/api/checkout/status?bid=${r.json.bid_id}`)).json
      .status,
    "confirming",
    "unpaid stays confirming",
  );
  const p = payment(r.json.bid_id, sessionId);
  dodoState.payments.set(p.payment_id, p);
  dodoState.sessions.set(sessionId, {
    payment_id: p.payment_id,
    payment_status: "succeeded",
  });
  db.prepare("UPDATE bids SET last_checked_at = 0 WHERE id = ?").run(
    r.json.bid_id,
  );
  const s = await call(env, "GET", `/api/checkout/status?bid=${r.json.bid_id}`);
  eq(
    [s.json.status, s.json.rank, s.json.paid_tax],
    ["paid", 1, 180],
    "recovered without webhook",
  );
  eq(
    (
      await call(
        env,
        "GET",
        "/api/checkout/status?bid=bid_ffffffffffffffffffffffff",
      )
    ).status,
    404,
    "unknown bid",
  );
  eq(
    (await call(env, "GET", "/api/checkout/status?bid=' OR 1=1 --")).status,
    400,
    "garbage id",
  );
});

await test("hourly reconcile: settles missed payments, expires abandoned checkouts, flags stuck rows", async () => {
  const { env, db } = makeEnv();
  const paidLate = await checkout(env, {
    link: "late.com",
    category: "AI",
    target_dollars: 10,
    idempotency_key: key(),
  });
  const lateSession = [...dodoState.sessions.keys()].at(-1)!;
  const abandoned = await checkout(env, {
    link: "gone.com",
    category: "AI",
    target_dollars: 10,
    idempotency_key: key(),
  });
  db.prepare("UPDATE bids SET created_at = created_at - 5*60000").run();
  db.prepare(
    "UPDATE bids SET created_at = created_at - 27*3600000 WHERE id = ?",
  ).run(abandoned.json.bid_id);
  db.exec(`INSERT INTO bids (id, idempotency_key, environment, listing_key, link, brand, category, prior_cents, target_cents, charge_cents, status, created_at, updated_at)
           VALUES ('bid_bbbbbbbbbbbbbbbbbbbbbbbb','k-stuck-00000000001','test_mode','stuck.com','https://stuck.com','stuck.com','AI',0,1000,1000,'created',1,1)`);
  const p = payment(paidLate.json.bid_id, lateSession);
  dodoState.payments.set(p.payment_id, p);
  dodoState.sessions.set(lateSession, {
    payment_id: p.payment_id,
    payment_status: "succeeded",
  });

  const out = await reconcilePayments(env);
  eq(out, { checked: 2, applied: 1, expired: 1, errored: 1 }, "summary");
  eq(
    [
      bidRow(db, paidLate.json.bid_id).status,
      bidRow(db, abandoned.json.bid_id).status,
      bidRow(db, "bid_bbbbbbbbbbbbbbbbbbbbbbbb").status,
    ],
    ["paid", "expired", "error"],
    "statuses",
  );
  const again = await reconcilePayments(env);
  eq(again, { checked: 0, applied: 0, expired: 0, errored: 0 }, "idempotent");
});

await test("audit trail: every status change has exactly one transition row", async () => {
  const { env, db } = makeEnv();
  await paidBid(env, "a.com", 10);
  await paidBid(env, "b.com", 30);
  const bad = db
    .prepare(
      `SELECT b.id FROM bids b WHERE (SELECT to_status FROM bid_transitions t WHERE t.bid_id = b.id ORDER BY t.id DESC LIMIT 1) != b.status`,
    )
    .all();
  eq(bad.length, 0, "last transition matches status");
});

// ── report ──────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
for (const r of results)
  console.log(
    `${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.err ? `\n      ${r.err}` : ""}`,
  );
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
