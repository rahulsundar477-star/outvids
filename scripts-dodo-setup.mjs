// One-time Dodo Payments setup for Outbid (TEST MODE ONLY unless DODO_ENVIRONMENT=live_mode is passed on purpose).
// Creates the Pay-What-You-Want "Outbid listing" product and the webhook endpoint, then stores the webhook
// signing secret as a Worker secret. Prints IDs only — never keys or secrets.
//
//   DODO_PAYMENTS_API_KEY=... node scripts-dodo-setup.mjs
import DodoPayments from "dodopayments";
import { spawnSync } from "node:child_process";

const apiKey = process.env.DODO_PAYMENTS_API_KEY;
const environment =
  process.env.DODO_ENVIRONMENT === "live_mode" ? "live_mode" : "test_mode";
const WEBHOOK_URL = "https://outvids.lol/api/webhooks/dodo";
if (!apiKey) throw new Error("Set DODO_PAYMENTS_API_KEY in the environment");

const client = new DodoPayments({ bearerToken: apiKey, environment });
console.log(`environment: ${environment}`);

// Product: reuse if it already exists (safe to re-run).
let product;
for await (const p of client.products.list()) {
  if (p.name === "Outbid listing") {
    product = p;
    break;
  }
}
if (!product) {
  product = await client.products.create({
    name: "Outbid listing",
    description:
      "A ranked listing on the Outvids Outbid leaderboard (outvids.lol). The amount is the bid for the listing's position.",
    tax_category: "digital_products",
    price: {
      type: "one_time_price",
      currency: "USD",
      price: 100, // Pay What You Want minimum ($1, for raises). The Worker enforces $10 for new listings.
      pay_what_you_want: true,
      suggested_price: 1000,
      discount_bps: 0,
      purchasing_power_parity: false, // never discount bids by country
      tax_inclusive: false, // tax is added on top by Dodo (merchant of record)
    },
  });
  console.log(`created product: ${product.product_id}`);
} else {
  console.log(`product exists: ${product.product_id}`);
}

// Webhook endpoint: reuse if one already points at our URL.
let hook;
for await (const w of client.webhooks.list()) {
  if (w.url === WEBHOOK_URL) {
    hook = w;
    break;
  }
}
if (!hook) {
  hook = await client.webhooks.create({
    url: WEBHOOK_URL,
    description: "Outvids Outbid payments",
    filter_types: [
      "payment.succeeded",
      "payment.failed",
      "payment.cancelled",
      "payment.processing",
      "refund.succeeded",
      "refund.failed",
      "dispute.opened",
      "dispute.challenged",
      "dispute.won",
      "dispute.lost",
      "dispute.accepted",
      "dispute.cancelled",
      "dispute.expired",
    ],
    idempotency_key: `outvids-webhook-${environment}`,
  });
  console.log(`created webhook: ${hook.id}`);
} else {
  console.log(`webhook exists: ${hook.id}`);
}

// Signing secret → Worker secret, straight through stdin.
const { secret } = await client.webhooks.retrieveSecret(hook.id);
const put = spawnSync(
  process.execPath,
  [
    "node_modules/wrangler/bin/wrangler.js",
    "secret",
    "put",
    "DODO_PAYMENTS_WEBHOOK_KEY",
  ],
  {
    input: secret,
    encoding: "utf8",
  },
);
console.log(
  put.status === 0
    ? "stored DODO_PAYMENTS_WEBHOOK_KEY as a Worker secret"
    : `secret put failed: ${(put.stderr || "").slice(0, 200)}`,
);
console.log(`DODO_BID_PRODUCT_ID=${product.product_id}`);
