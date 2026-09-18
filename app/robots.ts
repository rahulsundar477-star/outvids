import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

// Cloudflare's managed robots.txt (AI-crawler rules) is prepended to this at the edge.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/"] }],
    sitemap: `${SITE.url}/sitemap.xml`,
    host: SITE.url,
  };
}
