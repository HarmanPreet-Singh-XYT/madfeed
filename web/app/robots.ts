import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

// The public marketing pages are indexable. The product itself, its sign-in pages and the per-customer
// public surfaces (forms, chat, surveys, release pages) are not listed here.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: [
        "/",
        "/features",
        "/integrations",
        "/pricing",
        "/docs",
        "/faq",
        "/about",
        "/community",
        "/contact",
        "/security",
        "/privacy",
        "/terms",
        "/cookies",
        "/subprocessors",
      ],
      disallow: [
        "/w/",
        "/home",
        "/login",
        "/signup",
        "/api/",
        "/invite/",
        "/f/",
        "/chat/",
        "/s/",
        "/embed/",
        "/oauth/",
        "/unsubscribe/",
        "/digest/",
        "/integrations/slack",
      ],
    },
    sitemap: `${SITE.url}/sitemap.xml`,
  };
}
