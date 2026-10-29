import { isUuid } from "@/lib/text";
import { apiBase, apiFetch, sessionToken } from "@/lib/server/transport";
import { sameSite } from "@/lib/server/media-proxy";

const MAX = 2 * 1024 * 1024 + 1024;

type Ctx = { params: Promise<{ workspaceId: string; noteId: string }> };

/** PNG and JPEG start with signatures nobody else uses; the API delivers plain bytes. */
function imageType(b: Uint8Array): string {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
    return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  return "application/octet-stream";
}

const apiPath = (workspaceId: string, noteId: string) =>
  `${apiBase}/v1/workspaces/${workspaceId}/release-notes/${noteId}/cover`;

// A cover picture the team is working on: stored by the API, which checks the bytes, strips what is
// hidden in them and keeps the size limit.
export async function PUT(request: Request, ctx: Ctx) {
  if (!sameSite(request))
    return Response.json({ error: { message: "Not allowed." } }, { status: 403 });
  const { workspaceId, noteId } = await ctx.params;
  if (![workspaceId, noteId].every(isUuid))
    return Response.json({ error: { message: "Not found." } }, { status: 404 });
  const token = await sessionToken();
  if (!token)
    return Response.json({ error: { message: "Please sign in again." } }, { status: 401 });
  const len = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(len) || len > MAX)
    return Response.json(
      { error: { message: "That picture is larger than 2 MB." } },
      { status: 413 },
    );
  // At most 2 MB: reading it whole keeps this route simple and cannot stream an endless body.
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0)
    return Response.json(
      { error: { message: "That picture is empty." } },
      { status: 400 },
    );
  const res = await apiFetch(apiPath(workspaceId, noteId), {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
    },
    body: bytes,
    cache: "no-store",
  });
  if (res.status === 204) return new Response(null, { status: 204 });
  return new Response(await res.text(), {
    status: res.status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// The team's own copy, for the editor and its preview. The address carries the picture's version, so it
// can be cached for a while without ever showing the picture it replaced.
export async function GET(_request: Request, ctx: Ctx) {
  const { workspaceId, noteId } = await ctx.params;
  if (![workspaceId, noteId].every(isUuid))
    return new Response(null, { status: 404 });
  const token = await sessionToken();
  if (!token) return new Response(null, { status: 401 });
  const res = await apiFetch(apiPath(workspaceId, noteId), {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) return new Response(null, { status: res.status });
  const bytes = new Uint8Array(await res.arrayBuffer());
  return new Response(bytes, {
    headers: {
      "Content-Type": imageType(bytes),
      "Content-Length": String(bytes.byteLength),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=86400",
    },
  });
}

export async function DELETE(request: Request, ctx: Ctx) {
  if (!sameSite(request))
    return Response.json({ error: { message: "Not allowed." } }, { status: 403 });
  const { workspaceId, noteId } = await ctx.params;
  if (![workspaceId, noteId].every(isUuid))
    return Response.json({ error: { message: "Not found." } }, { status: 404 });
  const token = await sessionToken();
  if (!token)
    return Response.json({ error: { message: "Please sign in again." } }, { status: 401 });
  const res = await apiFetch(apiPath(workspaceId, noteId), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (res.status === 204) return new Response(null, { status: 204 });
  return new Response(await res.text(), {
    status: res.status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
