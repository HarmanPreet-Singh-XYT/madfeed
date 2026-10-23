import "server-only";
import { isUuid } from "@/lib/text";
import { getToken } from "./session";

const baseUrl = process.env.API_URL ?? "http://127.0.0.1:8080";

export type ProxyContext = {
  params: Promise<{ workspaceId: string; mediaId: string }>;
};

/**
 * These routes move recording bytes between the browser and the API. They
 * exist only because the browser never holds the access token or learns the
 * API address. Cookie-authenticated requests that change data must come from
 * this site, so a page on another site cannot upload on someone's behalf.
 */
export function sameSite(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // same-origin GETs and non-browser clients send none
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

export async function target(
  ctx: ProxyContext,
  tail: string,
): Promise<{ url: string; token: string; ids: [string, string] } | Response> {
  const { workspaceId, mediaId } = await ctx.params;
  if (!isUuid(workspaceId) || !isUuid(mediaId))
    return Response.json({ error: "Not found." }, { status: 404 });
  const token = await getToken();
  if (!token)
    return Response.json({ error: "Please sign in again." }, { status: 401 });
  return {
    url: `${baseUrl}/v1/workspaces/${workspaceId}/media/${mediaId}${tail}`,
    token,
    ids: [workspaceId, mediaId],
  };
}
