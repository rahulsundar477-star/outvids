/**
 * The kill switch: a Worker with no bindings at all.
 *
 * `npm run panic` deploys this over the live Worker in about 20 seconds. It keeps outvids.lol
 * answering, but with no R2, no D1, no cron and no Next.js — so nothing can meter, spend or
 * be abused while you work out what happened. `npm run resume` puts the real app back.
 *
 * Secrets are stored per Worker, not in the config, so they survive both directions.
 */
const PAGE = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Outvids — back shortly</title>
<style>
  :root { color-scheme: dark }
  body { margin:0; min-height:100dvh; display:grid; place-items:center; background:#0B0A0A; color:#F5F1EA;
         font:500 16px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; padding:24px }
  main { max-width:30rem; text-align:center }
  h1 { font-size:1.4rem; margin:0 0 .6rem; letter-spacing:-.02em }
  p { margin:0; color:#A8A29B; text-wrap:pretty }
  .dot { display:inline-block; width:8px; height:8px; border-radius:50%; background:#FF4D1C; margin-right:8px }
</style>
</head><body><main>
  <h1><span class="dot"></span>Outvids is paused</h1>
  <p>We've taken the feed down for a moment. Nothing is lost — votes, listings and payments are all safe. Try again shortly.</p>
</main></body></html>`;

export default {
  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    // Keep crawlers away while we're down, and answer the API with JSON rather than a page.
    if (pathname === "/robots.txt")
      return new Response("User-agent: *\nDisallow: /\n", {
        headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
      });
    if (pathname.startsWith("/api/") || pathname === "/feed.json")
      return Response.json(
        {
          error: "paused",
          message: "Outvids is paused. Nothing was charged by this request.",
        },
        {
          status: 503,
          headers: { "Cache-Control": "no-store", "Retry-After": "600" },
        },
      );
    return new Response(PAGE, {
      status: 503,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Retry-After": "600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  },
} satisfies ExportedHandler;
