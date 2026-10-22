import { getToken } from "@/lib/server/session";
import { isUuid } from "@/lib/text";

const baseUrl = process.env.API_URL ?? "http://127.0.0.1:8080";

// Downloads the workspace export. The token stays on the server: the browser
// asks us, and we ask the API.
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await ctx.params;
  if (!isUuid(workspaceId)) return new Response("Not found", { status: 404 });
  const token = await getToken();
  if (!token)
    return new Response(null, { status: 303, headers: { Location: "/login" } });

  const res = await fetch(`${baseUrl}/v1/workspaces/${workspaceId}/export`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (res.status === 401)
    return new Response(null, { status: 303, headers: { Location: "/login" } });
  if (!res.ok) {
    // Pass the status through without echoing the API's body.
    return new Response(
      res.status === 403
        ? "Only workspace admins can download everything."
        : "The download is not available.",
      { status: res.status === 403 ? 403 : 404 },
    );
  }
  return new Response(res.body, {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": 'attachment; filename="workspace-export.json"',
      "Cache-Control": "no-store",
    },
  });
}
