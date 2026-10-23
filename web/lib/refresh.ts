// Keeping a Supabase session alive. Plain functions with no framework imports,
// so both the proxy and route handlers can use them. Tokens are only ever read
// for their expiry here; the API is what actually verifies them.

/** Seconds until a JWT expires, or undefined if it can't be read. */
export function secondsLeft(jwt: string, now = Date.now()): number | undefined {
  const part = jwt.split(".")[1];
  if (!part) return undefined;
  try {
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === "number" ? Math.floor(exp - now / 1000) : undefined;
  } catch {
    return undefined;
  }
}

/** Refresh when this little time is left, so a request never carries an expired token. */
export const REFRESH_WITHIN_SECONDS = 90;

export type Refreshed = {
  token: string;
  refreshToken: string;
  expiresInSeconds: number;
};

/** Trades a refresh token for a new pair. undefined means the session is over. */
export async function refreshSession(
  refreshToken: string,
  env: { url?: string; key?: string } = {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_PUBLISHABLE_KEY,
  },
): Promise<Refreshed | undefined> {
  if (!env.url || !env.key || !refreshToken) return undefined;
  try {
    const res = await fetch(
      `${env.url.replace(/\/+$/, "")}/auth/v1/token?grant_type=refresh_token`,
      {
        method: "POST",
        headers: { apikey: env.key, "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (!res.ok) return undefined;
    const b = (await res.json()) as {
      access_token?: unknown;
      refresh_token?: unknown;
      expires_in?: unknown;
    };
    if (
      typeof b.access_token !== "string" ||
      b.access_token.split(".").length !== 3 ||
      typeof b.refresh_token !== "string"
    )
      return undefined;
    return {
      token: b.access_token,
      refreshToken: b.refresh_token,
      expiresInSeconds:
        typeof b.expires_in === "number" && b.expires_in > 0
          ? Math.floor(b.expires_in)
          : 3600,
    };
  } catch {
    return undefined;
  }
}

export const SESSION_COOKIE = "session";
export const REFRESH_COOKIE = "refresh";
export const MAX_SESSION_SECONDS = 8 * 60 * 60;
export const REFRESH_COOKIE_SECONDS = 30 * 24 * 60 * 60;
