import { isUuid } from "@/lib/text";
import { getToken } from "@/lib/server/session";
import { sameSite } from "@/lib/server/media-proxy";

const baseUrl = process.env.API_URL ?? "http://127.0.0.1:8080";
const MAX = 5 * 1024 * 1024;

type Ctx = { params: Promise<{ workspaceId: string; conversationId: string }> };

// A teammate's file for the next reply, streamed to the API (which checks the type, the size and the channel).
export async function POST(request: Request, ctx: Ctx) {
  if (!sameSite(request))
    return Response.json(
      { error: { message: "Not allowed." } },
      { status: 403 },
    );
  const { workspaceId, conversationId } = await ctx.params;
  if (![workspaceId, conversationId].every(isUuid))
    return Response.json({ error: { message: "Not found." } }, { status: 404 });
  const token = await getToken();
  if (!token)
    return Response.json(
      { error: { message: "Please sign in again." } },
      { status: 401 },
    );
  const len = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(len) || len > MAX + 1024)
    return Response.json(
      { error: { message: "That file is larger than 5 MB." } },
      { status: 413 },
    );
  const name =
    (new URL(request.url).searchParams.get("name") ?? "file").slice(0, 200) ||
    "file";
  const res = await fetch(
    `${baseUrl}/v1/workspaces/${workspaceId}/conversations/${conversationId}/attachments?${new URLSearchParams({ name })}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
      },
      body: request.body,
      // @ts-expect-error Node's fetch needs this to stream a request body
      duplex: "half",
      cache: "no-store",
    },
  );
  return new Response(await res.text(), {
    status: res.status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
