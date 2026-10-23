import { NextResponse, type NextRequest } from "next/server";
import {
  MAX_SESSION_SECONDS,
  REFRESH_COOKIE,
  REFRESH_COOKIE_SECONDS,
  REFRESH_WITHIN_SECONDS,
  SESSION_COOKIE,
  refreshSession,
  secondsLeft,
} from "@/lib/refresh";

// Keeps a signed-in person signed in. Access tokens last about an hour; shortly
// before one runs out we trade the refresh token for a new pair, so the pages
// being rendered (and the browser) both get the fresh token. If the refresh
// token no longer works, the session is cleared and the person signs in again.
export async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const refresh = request.cookies.get(REFRESH_COOKIE)?.value;
  if (!token || !refresh) return NextResponse.next();
  const left = secondsLeft(token);
  if (left === undefined || left > REFRESH_WITHIN_SECONDS)
    return NextResponse.next();

  const secure = process.env.NODE_ENV === "production";
  const cookie = (maxAge: number) =>
    ({ httpOnly: true, secure, sameSite: "lax", path: "/", maxAge }) as const;

  const fresh = await refreshSession(refresh);
  if (!fresh) {
    // Over for good: remove both cookies from what pages see and from the browser.
    request.cookies.delete(SESSION_COOKIE);
    request.cookies.delete(REFRESH_COOKIE);
    const out = NextResponse.next({ request });
    out.cookies.delete(SESSION_COOKIE);
    out.cookies.delete(REFRESH_COOKIE);
    return out;
  }
  request.cookies.set(SESSION_COOKIE, fresh.token);
  request.cookies.set(REFRESH_COOKIE, fresh.refreshToken);
  const out = NextResponse.next({ request });
  out.cookies.set(
    SESSION_COOKIE,
    fresh.token,
    cookie(Math.min(fresh.expiresInSeconds, MAX_SESSION_SECONDS)),
  );
  out.cookies.set(
    REFRESH_COOKIE,
    fresh.refreshToken,
    cookie(REFRESH_COOKIE_SECONDS),
  );
  return out;
}

export const config = {
  // Pages only: not assets, and not the upload/playback routes (those refresh for themselves
  // and must not have their bodies buffered by the proxy).
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico).*)"],
};
