# Security

## Reporting a vulnerability

Please report it privately at **https://outvids.lol/security** — not in a public issue.
You'll get a reference id, and reports go straight to the person who builds this.

The machine-readable version is at https://outvids.lol/.well-known/security.txt.

Good-faith research is welcome: use only listings and payments you own (in test mode, Dodo's test
cards, never a real card), no denial of service or spam, don't touch other people's data, and give us a
reasonable chance to fix things before you tell anyone else.

## What this repository does and doesn't contain

- **No secrets.** API keys, the webhook signing secret, the admin token and the IP hash salt are
  Cloudflare Worker secrets, set with `wrangler secret put`. Local copies live in `.dev.vars`, which is
  gitignored. `npm test` runs a scan of every file and every commit and fails if a key shows up.
- **Identifiers that are not secrets** do appear in `wrangler.jsonc`: the Cloudflare account id, the D1
  database id, and the Dodo product and business ids. None of them grants access without an API token.
- **Payments** are handled by Dodo Payments as merchant of record; card details never reach this code.
  A listing becomes paid only after a signed webhook is re-checked against Dodo's API
  (see `docs/payments.md`).

## Defences you can read in the code

- Bearer tokens are compared in constant time (`server/auth.ts`).
- State-changing browser requests must come from outvids.lol itself; localhost is accepted only when
  the Worker runs locally.
- Per-IP ceilings on checkout, votes, beacons and reports (`server/limit.ts`), on top of a WAF rule.
- Security headers on every response: HSTS, `frame-ancestors 'none'`, `nosniff`, a strict referrer
  policy and a locked-down permissions policy (`worker.ts`).
- IPs are never stored — only a salted hash, with the salt held as a secret.
