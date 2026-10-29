import { getPublicReleases } from "@/lib/server/public";

/** Everything that has been published, newest first, so a reader can subscribe instead of remembering to look. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const data = await getPublicReleases(slug);
  if (!data) return new Response("Not found", { status: 404 });
  // Absolute links are required in a feed; the request's own host is the address the reader used.
  const here = new URL(request.url);
  const base = (
    process.env.PUBLIC_ORIGIN ??
    `${here.protocol}//${request.headers.get("host") ?? here.host}`
  ).replace(/\/$/, "");
  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  const items = data.notes
    .map((n) => {
      const url = `${base}/r/${slug}/${n.id}`;
      return `    <item>
      <title>${esc(n.title)}</title>
      <link>${esc(url)}</link>
      <guid isPermaLink="true">${esc(url)}</guid>
      <pubDate>${new Date(n.publishedAt).toUTCString()}</pubDate>
      <description>${esc(n.body)}</description>
    </item>`;
    })
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>What's new at ${esc(data.workspaceName)}</title>
    <link>${esc(`${base}/r/${slug}`)}</link>
    <description>Recent changes and improvements.</description>
${items}
  </channel>
</rss>
`;
  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
