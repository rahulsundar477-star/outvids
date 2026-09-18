// Bindings/secrets not (yet) listed in wrangler.jsonc / .dev.vars.
interface CloudflareEnv {
  /** Cloudflare API token with Account Analytics: Read — lets the re-rank job query beacon stats. Optional. */
  CF_ANALYTICS_TOKEN?: string;
  /** Analytics Engine dataset for beacons. Optional until Analytics Engine is enabled on the account;
   *  delete this line once the binding is uncommented in wrangler.jsonc (wrangler types then declares it). */
  BEACONS?: AnalyticsEngineDataset;

  /** Dodo Payments API key (secret). Payments stay off until this, the webhook key and the product id exist. */
  DODO_PAYMENTS_API_KEY?: string;
  /** Dodo webhook signing secret (secret), from the webhook endpoint's page in the Dodo dashboard. */
  DODO_PAYMENTS_WEBHOOK_KEY?: string;
  /** Optional salt for hashing buyer IPs before storing them (secret). */
  IP_HASH_SALT?: string;
}
