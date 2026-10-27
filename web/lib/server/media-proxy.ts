import "server-only";
import { isUuid } from "@/lib/text";
import { cookies } from "next/headers";
import {
  MAX_SESSION_SECONDS,
  REFRESH_COOKIE,
  REFRESH_COOKIE_SECONDS,
  REFRESH_WITHIN_SECONDS,
  SESSION_COOKIE,
  refreshSession,
  secondsLeft,
} from "@/lib/refresh";
import { apiBase, sessionToken } from "@/lib/server/transport";

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

/**
 * The access token for this request, renewed first if it is about to run out
 * (a long upload outlasts one token). The new pair is saved to the cookies.
 */
async function liveToken(): Promise<string | undefined> {
  const token = await sessionToken();
  if (!token) return undefined;
  const jar = await cookies();
  const refresh = jar.get(REFRESH_COOKIE)?.value;
  const left = secondsLeft(token);
  if (!refresh || left === undefined || left > REFRESH_WITHIN_SECONDS)
    return token;
  const fresh = await refreshSession(refresh);
  if (!fresh) return left > 0 ? token : undefined;
  const opts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  } as const;
  jar.set(SESSION_COOKIE, fresh.token, {
    ...opts,
    maxAge: Math.min(fresh.expiresInSeconds, MAX_SESSION_SECONDS),
  });
  jar.set(REFRESH_COOKIE, fresh.refreshToken, {
    ...opts,
    maxAge: REFRESH_COOKIE_SECONDS,
  });
  return fresh.token;
}

export async function target(
  ctx: ProxyContext,
  tail: string,
): Promise<{ url: string; token: string; ids: [string, string] } | Response> {
  const { workspaceId, mediaId } = await ctx.params;
  if (!isUuid(workspaceId) || !isUuid(mediaId))
    return Response.json({ error: "Not found." }, { status: 404 });
  const token = await liveToken();
  if (!token)
    return Response.json({ error: "Please sign in again." }, { status: 401 });
  return {
    url: `${apiBase}/v1/workspaces/${workspaceId}/media/${mediaId}${tail}`,
    token,
    ids: [workspaceId, mediaId],
  };
}
