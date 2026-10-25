import { connection, NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { setRefreshToken, setToken } from "@/lib/server/session";
import {
  NEXT_COOKIE,
  PKCE_COOKIE,
  exchangeCode,
  forgetTrip,
  ssoEnabled,
} from "@/lib/server/sso";
import { safeNext } from "@/lib/next-path";
import { validCode, validVerifier } from "@/lib/sso";

// The way back from the company's identity system. It finishes the trip with the one-time code and the secret
// kept at the start; a missing, old or mismatched secret, or a bad code, ends in the sign-in page with a plain
// message and nothing stored.
// (Route handlers that read cookies or the request are dynamic on their own.)

function back(path: string): NextResponse {
  return NextResponse.redirect(new URL(path, process.env.PUBLIC_WEB_URL), 303);
}

export async function GET(request: NextRequest) {
  await connection(); // decided per request from the running server's settings, never frozen into the build
  if (!ssoEnabled()) return new NextResponse(null, { status: 404 });
  const jar = await cookies();
  const verifier = jar.get(PKCE_COOKIE)?.value;
  const next = safeNext(jar.get(NEXT_COOKIE)?.value);
  await forgetTrip();
  const code = request.nextUrl.searchParams.get("code");
  if (!validCode(code) || !validVerifier(verifier))
    return back("/login?sso=failed");
  const res = await exchangeCode(code, verifier);
  if (!res.ok) return back("/login?sso=failed");
  await setToken(res.token, Math.min(res.expiresInSeconds, 8 * 60 * 60));
  if (res.refreshToken) await setRefreshToken(res.refreshToken);
  return back(next);
}
