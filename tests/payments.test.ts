/**
 * End-to-end tests for server/payments.ts against a real SQLite database (the D1 migrations),
 * real webhook signature verification, and a mocked Dodo network. No production data is touched.
 * Run: npm run test:payments
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { Webhook } from "standardwebhooks";
import { handlePayments, reconcilePayments } from "../server/payments";
import { resetEdgeLimit } from "../server/limit";
import { handleSecurity } from "../server/security";
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

// R2 stand-in for stored brand icons.
function r2() {
  const store = new Map<string, { body: Uint8Array; type?: string }>();
  return {
    store,
    async put(key: string, body: Uint8Array, opts?: { httpMetadata?: { contentType?: string } }) {
      store.set(key, { body, type: opts?.httpMetadata?.contentType });
      return { key };
    },
    async get(key: string) {
      const v = store.get(key);
      return v ? { body: v.body, size: v.body.length } : null;
    },
  };
}

// Real file headers, so the icon picker reads real dimensions out of them.
function png(w: number, h: number, len = 400) {
  const b = new Uint8Array(Math.max(len, 33));
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  b.set([0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52], 8); // length + "IHDR"
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
}
function ico(w: number, h: number, len = 200) {
  const b = new Uint8Array(Math.max(len, 22));
  b.set([0, 0, 1, 0, 1, 0], 0); // ICO, one image
  b[6] = w % 256; // 0 means 256
  b[7] = h % 256;
  return b;
}

// Outbound fetch is disabled by default; tests opt in per URL.
export const net = { routes: new Map<string, () => Response>(), calls: [] as string[] };
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  net.calls.push(url);
  const make = net.routes.get(url) ?? net.routes.get(url.replace(/\/$/, "")) ?? net.routes.get(url + "/");
  if (!make) throw new TypeError(`network disabled in tests: ${url}`);
  return make();
}) as typeof fetch;

const WEBHOOK_SECRET =
  "whsec_" +
  Buffer.from("outvids-test-webhook-secret-32bytes!!").toString("base64");
const PRODUCT = "pdt_outbid_test";
const ORIGIN = "https://outvids.lol";

function makeEnv(overrides: Record<string, unknown> = {}) {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync("migrations")
    .filter((n) => n.endsWith(".sql"))
    .sort())
    db.exec(readFileSync(`migrations/${f}`, "utf8"));
  let limited = false;
  const env = {
    DB: d1(db),
    CLIPS: r2(),
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
  resetEdgeLimit();
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

await test("the edge counter caps checkouts even when the platform limiter lets them through", async () => {
  // Cloudflare's rate limiting binding is permissive by design — in production it let 40 sequential
  // requests past a 10/minute limit — so the ceiling has to hold without it.
  const { env, db } = makeEnv({ CHECKOUT_RL: undefined });
  const codes: number[] = [];
  for (let i = 0; i < 12; i++) {
    const r = await checkout(env, {
      link: `acme${i}.com`,
      category: "AI",
      target_dollars: 10,
      idempotency_key: key(),
    });
    codes.push(r.status);
  }
  eq(codes.slice(0, 10).every((c) => c === 200), true, "first ten go through");
  eq(codes.slice(10).every((c) => c === 429), true, "the rest are refused");
  eq(
    count(db, "SELECT COUNT(*) AS n FROM bids") <= 10,
    true,
    "nothing past the cap reached the database",
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

await test("brand details are fetched once after payment and shown on the board", async () => {
  const { env, db } = makeEnv();
  const html = `<!doctype html><html><head>
    <title>Selvo — Intercom alternative without per-seat fees</title>
    <meta property="og:site_name" content="Selvo">
    <meta name="description" content="Support inbox &amp; live chat without per-seat pricing.">
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-icon.png">
    <link rel="icon" href="/favicon.ico">
  </head><body>ignored</body></html>`;
  net.routes.set("https://brandsite.co/", () => new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } }));
  net.routes.set("https://brandsite.co/apple-icon.png", () => new Response(png(180, 180), { headers: { "content-type": "image/png" } }));

  await paidBid(env, "brandsite.co", 20);
  const meta = db.prepare("SELECT * FROM listing_meta WHERE listing_key = 'brandsite.co'").get() as Record<string, any>;
  eq([meta.name, meta.description, meta.status], ["Selvo", "Support inbox & live chat without per-seat pricing.", "ok"], "stored details");
  eq([meta.icon_key, meta.icon_type, meta.icon_bytes], ["brand-icons/brandsite.co.png", "image/png", 400], "stored icon");
  eq([meta.icon_w, meta.icon_h], [180, 180], "stored icon size");

  const b = await board(env);
  eq(b.entries[0].name, "Selvo", "board name");
  eq(
    String(b.entries[0].icon).split("?")[0],
    "/api/icon/brandsite.co",
    "board icon path",
  );
  eq(/\?v=\d{10,}$/.test(String(b.entries[0].icon)), true, "icon url is versioned");
  eq(net.calls.filter((u) => u.startsWith("https://brandsite.co")).length, 2, "one page + one icon fetch");
});

await test("text from a brand page: entities decode, apostrophes survive, markup is stripped", async () => {
  const { env, db } = makeEnv();
  const html = [
    "<!doctype html><html><head>",
    "<title>Probe A&rsquo;s B&#8217;s C&#x2019;s D’s E&amp;F</title>",
    '<meta name="description" content="named A&rsquo;s decimal B&#8217;s hex C&#x2019;s literal D’s amp E&amp;F dash G&mdash;H unknown I&zzz;J">',
    '<link rel="icon" href="/favicon.ico">',
    "</head><body>x</body></html>",
  ].join("");
  net.routes.set("https://probe-entities.com", () => new Response(html, { headers: { "content-type": "text/html" } }));
  net.routes.set("https://probe-entities.com/favicon.ico", () => new Response(ico(32, 32), { headers: { "content-type": "image/x-icon" } }));

  await paidBid(env, "probe-entities.com", 10);
  const meta = db.prepare("SELECT name, description FROM listing_meta WHERE listing_key = 'probe-entities.com'").get() as Record<string, any>;
  eq(meta.name, "Probe A’s B’s C’s D’s E&F", "title entities");
  eq(
    meta.description,
    "named A’s decimal B’s hex C’s literal D’s amp E&F dash G—H unknown IJ",
    "description entities",
  );
});

await test("a long page title becomes a brand name plus a tagline", async () => {
  const { env, db } = makeEnv();
  const page = (title: string) =>
    `<!doctype html><html><head><title>${title}</title></head><body>x</body></html>`;

  const cases: [string, string, string, string | null][] = [
    ["splitter.com", "Selvo \u2014 Intercom alternative without per-seat fees", "Selvo", "Intercom alternative without per-seat fees"],
    ["piped.com", "EssayDone | Focus on Your Insights; We Handle the Writing", "EssayDone", "Focus on Your Insights; We Handle the Writing"],
    // "Home" first reads backwards, so the brand is taken from the other end.
    ["backwards.com", "Home | Orelon", "Orelon", null],
    // Short titles are already a name: never split, never truncated.
    // The product is named at the end here, and it is still the short side.
    ["reversed.com", "AI SEO Platform (GEO, AEO): Traffic from AI Search | RankControl", "RankControl", null],
    ["short.com", "Cubicles", "Cubicles", null],
  ];

  for (const [key, title, name] of cases) {
    net.routes.set(`https://${key}`, () => new Response(page(title), { headers: { "content-type": "text/html" } }));
    await paidBid(env, key, 10);
    const meta = db.prepare("SELECT name FROM listing_meta WHERE listing_key = ?").get(key) as Record<string, any>;
    eq(meta.name, name, `${key} name`);
  }
});

await test("the icon is the biggest one the site offers, not the first", async () => {
  const { env, db } = makeEnv();
  const html = `<!doctype html><html><head>
    <title>Bigicon</title>
    <link rel="icon" sizes="16x16" href="/favicon.ico">
    <link rel="manifest" href="/site.webmanifest">
  </head><body>x</body></html>`;
  net.routes.set("https://bigicon.dev", () => new Response(html, { headers: { "content-type": "text/html" } }));
  net.routes.set("https://bigicon.dev/site.webmanifest", () =>
    new Response(JSON.stringify({ icons: [{ src: "/i-192.png", sizes: "192x192" }, { src: "/i-32.png", sizes: "32x32" }] }), {
      headers: { "content-type": "application/manifest+json" },
    }),
  );
  net.routes.set("https://bigicon.dev/favicon.ico", () => new Response(ico(16, 16), { headers: { "content-type": "image/x-icon" } }));
  net.routes.set("https://bigicon.dev/i-192.png", () => new Response(png(192, 192, 900), { headers: { "content-type": "image/png" } }));
  net.routes.set("https://bigicon.dev/i-32.png", () => new Response(png(32, 32), { headers: { "content-type": "image/png" } }));

  await paidBid(env, "bigicon.dev", 10);
  const meta = db.prepare("SELECT * FROM listing_meta WHERE listing_key = 'bigicon.dev'").get() as Record<string, any>;
  eq([meta.icon_key, meta.icon_w], ["brand-icons/bigicon.dev.png", 192], "kept the 192px manifest icon");
  // 192px clears the bar on the first download, so the 16px favicon is never fetched.
  eq(net.calls.includes("https://bigicon.dev/favicon.ico"), false, "no wasted favicon fetch");
});

await test("a small favicon is still kept when the site has nothing better", async () => {
  const { env, db } = makeEnv();
  const html = `<!doctype html><html><head><title>Tinyicon</title><link rel="icon" href="/favicon.ico"></head><body>x</body></html>`;
  net.routes.set("https://tinyicon.dev", () => new Response(html, { headers: { "content-type": "text/html" } }));
  net.routes.set("https://tinyicon.dev/favicon.ico", () => new Response(ico(32, 32), { headers: { "content-type": "image/x-icon" } }));

  await paidBid(env, "tinyicon.dev", 10);
  const meta = db.prepare("SELECT * FROM listing_meta WHERE listing_key = 'tinyicon.dev'").get() as Record<string, any>;
  eq([meta.icon_type, meta.icon_w, meta.status], ["image/x-icon", 32, "ok"], "kept the 32px icon");
  // It looked for something better first, but never more than the cap.
  eq(net.calls.filter((u) => u.startsWith("https://tinyicon.dev")).length <= 5, true, "at most four icon tries");
});

await test("a brand site that is down never blocks the payment", async () => {
  const { env, db } = makeEnv();
  const { bidId } = await paidBid(env, "offline-brand.com", 15); // no routes registered: every fetch throws
  eq(bidRow(db, bidId).status, "paid", "payment still paid");
  const meta = db.prepare("SELECT status, name, icon_key FROM listing_meta WHERE listing_key = 'offline-brand.com'").get() as Record<string, any>;
  eq(meta.status, "failed", "recorded as failed");
  const b = await board(env);
  eq([b.entries[0].key, b.entries[0].icon, b.entries[0].name], ["offline-brand.com", null, null], "board still lists it, without details");
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

// ── security reports (/api/security-report) ─────────────────────────────────
async function report(env: CloudflareEnv, body: unknown, headers: Record<string, string> = {}) {
  const res = await handleSecurity(
    new Request(ORIGIN + "/api/security-report", {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json", "cf-connecting-ip": "198.51.100.9", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    env,
  );
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, any> };
}
const goodReport = {
  summary: "Vote endpoint accepts unknown viewer ids",
  details: "Posting to /api/vote with a made-up viewer_id is accepted and counted as a real vote.",
  url: "https://outvids.lol/api/vote",
  contact: "researcher@example.com",
};

await test("security report: stored once, IP only as a hash, fields trimmed", async () => {
  const { env, db } = makeEnv();
  const r = await report(env, { ...goodReport, summary: "  " + goodReport.summary + "\u0007  " });
  eq(r.status, 201, "accepted");
  eq(/^sr_[0-9a-f]{16}$/.test(String(r.json.id)), true, "reference id");
  const row = db.prepare("SELECT * FROM security_reports").get() as Record<string, any>;
  eq([row.summary, row.status, row.contact], [goodReport.summary, "new", goodReport.contact], "stored as sent, cleaned");
  eq(/^[0-9a-f]{32}$/.test(row.ip_hash) && !String(row.ip_hash).includes("198.51"), true, "ip is hashed");
});

await test("security report: other sites, non-JSON, junk and bots are turned away", async () => {
  const { env, db } = makeEnv();
  eq((await report(env, goodReport, { origin: "https://evil.example" })).status, 403, "cross-origin");
  eq((await report(env, "summary=x", { "content-type": "application/x-www-form-urlencoded" })).status, 415, "form post");
  eq((await report(env, "{not json")).status, 400, "bad json");
  eq((await report(env, { summary: "hi", details: "short" })).status, 400, "too short");
  eq((await report(env, { ...goodReport, details: "x".repeat(8001) })).status, 400, "too long");
  eq((await report(env, "x".repeat(17_000))).status, 413, "body cap");
  const bot = await report(env, { ...goodReport, website: "http://spam.example" });
  eq(bot.status, 202, "honeypot gets a quiet yes");
  eq(count(db, "SELECT COUNT(*) AS n FROM security_reports"), 0, "nothing stored for any of them");
});

await test("security report: five an hour per address, then refused", async () => {
  const { env, db } = makeEnv();
  const codes: number[] = [];
  for (let i = 0; i < 7; i++) codes.push((await report(env, { ...goodReport, summary: `Report number ${i}` })).status);
  eq(codes, [201, 201, 201, 201, 201, 429, 429], "cap at five");
  eq(count(db, "SELECT COUNT(*) AS n FROM security_reports"), 5, "only five stored");
});

// ── report ──────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
for (const r of results)
  console.log(
    `${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.err ? `\n      ${r.err}` : ""}`,
  );
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
