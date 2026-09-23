/**
 * Small, shared security checks. The source is public, so none of these may rely on anyone not
 * knowing how they work — only on the secrets they compare against.
 */

/**
 * Constant-time string comparison for bearer tokens. Both sides are hashed first, so the compare
 * always runs over 32 bytes: it leaks neither where the strings differ nor how long the secret is.
 */
export async function safeEqual(
  given: string,
  expected: string,
): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(given)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/** `Authorization: Bearer <token>` against a configured secret. No secret configured means no access. */
export async function hasBearer(
  request: Request,
  expected: string | undefined,
): Promise<boolean> {
  if (!expected) return false;
  const given = (request.headers.get("authorization") ?? "").replace(
    /^Bearer\s+/i,
    "",
  );
  return given.length > 0 && (await safeEqual(given, expected));
}

const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/**
 * Origins allowed to make state-changing browser requests. Production accepts only its own origin;
 * the localhost dev origins are added only when the Worker itself is running locally.
 */
export function allowedOrigins(publicOrigin: string | undefined): Set<string> {
  const origin = (publicOrigin || "https://outvids.lol").replace(/\/$/, "");
  const set = new Set([origin]);
  if (LOCAL.test(origin))
    for (const o of [
      "http://localhost:3100",
      "http://localhost:8787",
      "http://127.0.0.1:8787",
    ])
      set.add(o);
  return set;
}
