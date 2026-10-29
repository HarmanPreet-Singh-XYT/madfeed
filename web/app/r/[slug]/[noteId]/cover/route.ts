import { apiBase, apiFetch } from "@/lib/server/transport";
import { isUuid } from "@/lib/text";

type Ctx = { params: Promise<{ slug: string; noteId: string }> };

const SLUG = /^[a-z0-9][a-z0-9-]{2,39}$/;

function imageType(b: Uint8Array): string {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
    return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  return "application/octet-stream";
}

/**
 * A published note's cover, for the public page. Same origin, so the page's own security policy is
 * unchanged; the API decides whether the note is live and answers not found when it is not.
 */
export async function GET(_request: Request, ctx: Ctx) {
  const { slug, noteId } = await ctx.params;
  if (!SLUG.test(slug) || !isUuid(noteId))
    return new Response(null, { status: 404 });
  const res = await apiFetch(
    `${apiBase}/v1/public/releases/${slug}/${noteId}/cover`,
    { cache: "no-store" },
  );
  if (!res.ok) return new Response(null, { status: 404 });
  const bytes = new Uint8Array(await res.arrayBuffer());
  return new Response(bytes, {
    headers: {
      "Content-Type": imageType(bytes),
      "Content-Length": String(bytes.byteLength),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=300",
    },
  });
}
