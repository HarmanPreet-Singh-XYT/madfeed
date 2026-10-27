import "server-only";
import { cookies } from "next/headers";
import { parseProviders } from "@/lib/sso";
import { authFetch, authService } from "@/lib/server/auth-transport";
import { supabaseConfigured, type PasswordSignIn } from "./supabase-auth";

// Sign-in through a company's own identity system (a SAML or OIDC provider set up in Supabase), or a provider
// button such as Google. Off unless SSO_ENABLED=true; needs PUBLIC_WEB_URL so the way back is a fixed address.

export function ssoEnabled(): boolean {
  return (
    process.env.SSO_ENABLED === "true" &&
    supabaseConfigured() &&
    Boolean(process.env.PUBLIC_WEB_URL)
  );
}

export function ssoProviders(): string[] {
  return ssoEnabled() ? parseProviders(process.env.SSO_PROVIDERS) : [];
}

export function callbackUrl(): string {
  return `${process.env.PUBLIC_WEB_URL!.replace(/\/+$/, "")}/login/sso/callback`;
}

const base = () => authService()!.base;
const headers = () => ({
  apikey: authService()!.key,
  "Content-Type": "application/json",
});

export const PKCE_COOKIE = "sso_pkce";
export const NEXT_COOKIE = "sso_next";

/** Keeps the secret that proves the trip started here, and where to go afterwards, for ten minutes. */
export async function rememberTrip(verifier: string, next: string) {
  const jar = await cookies();
  const opts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax", // the way back is a top-level link from the identity system, which "strict" would drop
    path: "/login/sso",
    maxAge: 600,
  } as const;
  jar.set(PKCE_COOKIE, verifier, opts);
  jar.set(NEXT_COOKIE, next, opts);
}

export async function forgetTrip() {
  const jar = await cookies();
  jar.delete({ name: PKCE_COOKIE, path: "/login/sso" });
  jar.delete({ name: NEXT_COOKIE, path: "/login/sso" });
}

/** Where to send the browser to sign in with the company's identity system for this email domain. */
export async function ssoUrlForDomain(
  domain: string,
  challenge: string,
): Promise<{ url: string } | { error: string }> {
  let res: Response;
  try {
    res = await authFetch(`${base()}/auth/v1/sso`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        domain,
        redirect_to: callbackUrl(),
        code_challenge: challenge,
        code_challenge_method: "s256",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return {
      error: "We couldn't reach the sign-in service. Try again in a moment.",
    };
  }
  const body = (await res.json().catch(() => undefined)) as
    { url?: unknown; error_code?: unknown } | undefined;
  if (res.status === 404 || body?.error_code === "sso_provider_not_found")
    return {
      error:
        "Company sign-in isn't set up for that email address. Ask your admin, or sign in with a password.",
    };
  if (!res.ok || typeof body?.url !== "string")
    return {
      error: "We couldn't start company sign-in. Try again in a moment.",
    };
  try {
    const u = new URL(body.url);
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
  } catch {
    return {
      error: "We couldn't start company sign-in. Try again in a moment.",
    };
  }
  return { url: body.url };
}

export function providerUrl(provider: string, challenge: string): string {
  const q = new URLSearchParams({
    provider,
    redirect_to: callbackUrl(),
    code_challenge: challenge,
    code_challenge_method: "s256",
  });
  return `${base()}/auth/v1/authorize?${q}`;
}

/** Trades the one-time code for a session, proving it is the browser that started the trip. */
export async function exchangeCode(
  code: string,
  verifier: string,
): Promise<PasswordSignIn> {
  const fail = {
    ok: false,
    message: "We couldn't finish signing you in. Please try again.",
  } as const;
  let res: Response;
  try {
    res = await authFetch(`${base()}/auth/v1/token?grant_type=pkce`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return fail;
  }
  const body = (await res.json().catch(() => undefined)) as
    | { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown }
    | undefined;
  const token = body?.access_token;
  if (!res.ok || typeof token !== "string" || token.split(".").length !== 3)
    return fail;
  const expires = body?.expires_in;
  return {
    ok: true,
    token,
    refreshToken:
      typeof body?.refresh_token === "string" && body.refresh_token
        ? body.refresh_token
        : undefined,
    expiresInSeconds:
      typeof expires === "number" && expires > 0 ? Math.floor(expires) : 3600,
  };
}
