import { isUuid } from "@/lib/text";
import { getToken } from "@/lib/server/session";

const baseUrl = process.env.API_URL ?? "http://127.0.0.1:8080";

type Ctx = {
  params: Promise<{
    workspaceId: string;
    conversationId: string;
    fileId: string;
  }>;
};

// A file from a conversation, always as a download (never shown inside our own pages).
export async function GET(_request: Request, ctx: Ctx) {
  const { workspaceId, conversationId, fileId } = await ctx.params;
  if (![workspaceId, conversationId, fileId].every(isUuid))
    return new Response(null, { status: 404 });
  const token = await getToken();
  if (!token) return new Response(null, { status: 401 });
  const res = await fetch(
    `${baseUrl}/v1/workspaces/${workspaceId}/conversations/${conversationId}/attachments/${fileId}`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
  );
  if (!res.ok) return new Response(null, { status: res.status });
  return new Response(res.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition":
        res.headers.get("content-disposition") ?? "attachment",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
