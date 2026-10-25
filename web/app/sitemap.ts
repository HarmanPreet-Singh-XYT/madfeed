import type { MetadataRoute } from "next";
import { DOCS } from "@/lib/docs-content";
import { PAGES, SITE } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const paths = [...PAGES, ...DOCS.map((d) => `/docs/${d.slug}`)];
  return paths.map((p) => ({ url: `${SITE.url}${p === "/" ? "" : p}` }));
}
