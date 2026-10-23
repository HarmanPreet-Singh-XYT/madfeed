import "server-only";

// Email-and-password sign-in against Supabase Auth, done on the server so the
// person's password never touches page JavaScript and the access token goes
// straight into an httpOnly cookie. Only the publishable key is used (it is
// meant to be public); no secret key exists anywhere in this app.

export function supabaseConfigured(): boolean {
  return Boolean(
    process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY,
  );
}

export type PasswordSignIn =
  | { ok: true; token: string; refreshToken?: string; expiresInSeconds: number }
  | { ok: false; message: string };

const FALLBACK =
  "We couldn't sign you in right now. Please try again in a moment.";

/**
 * What a person is told, whatever the service said. Upstream text is never
 * shown: it can name internals, and "wrong password" vs "no such user" must
 * stay indistinguishable.
 */
function explain(status: number, code: string | undefined): string {
  if (code === "email_not_confirmed")
    return "Confirm your email address first: we sent you a link when your account was created.";
  if (code === "invalid_credentials" || status === 400)
    return "That email and password don't match.";
  if (status === 429 || code === "over_request_rate_limit")
    return "Too many attempts. Wait a minute and try again.";
  return FALLBACK;
}

export async function signInWithPassword(
  email: string,
  password: string,
): Promise<PasswordSignIn> {
  if (!supabaseConfigured())
    return { ok: false, message: "Sign-in isn't set up yet." };
  const base = process.env.SUPABASE_URL!.replace(/\/+$/, "");
  let res: Response;
  try {
    res = await fetch(`${base}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        apikey: process.env.SUPABASE_PUBLISHABLE_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { ok: false, message: FALLBACK };
  }
  const body = (await res.json().catch(() => undefined)) as
    | {
        access_token?: unknown;
        refresh_token?: unknown;
        expires_in?: unknown;
        error_code?: unknown;
      }
    | undefined;
  if (!res.ok)
    return {
      ok: false,
      message: explain(
        res.status,
        typeof body?.error_code === "string" ? body.error_code : undefined,
      ),
    };
  const token = body?.access_token;
  const expires = body?.expires_in;
  if (typeof token !== "string" || token.split(".").length !== 3)
    return { ok: false, message: FALLBACK };
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

export type PasswordSignUp =
  | { ok: true; session: Extract<PasswordSignIn, { ok: true }> }
  | { ok: true; session?: undefined } // account created; a confirmation email is on its way
  | { ok: false; message: string };

function explainSignUp(status: number, code: string | undefined): string {
  if (code === "weak_password")
    return "Choose a stronger password: at least 10 characters.";
  if (code === "signup_disabled")
    return "New accounts can't be created right now.";
  if (code === "email_address_invalid" || code === "validation_failed")
    return "That email address doesn't look right.";
  if (
    status === 429 ||
    code === "over_request_rate_limit" ||
    code === "over_email_send_rate_limit"
  )
    return "Too many attempts. Wait a minute and try again.";
  return "We couldn't create your account right now. Please try again in a moment.";
}

/**
 * Creates an account. Supabase decides whether the person must confirm their email first; either
 * way the answer to the person is the same for an address that is new and one that is taken, so
 * this cannot be used to find out who already has an account.
 */
export async function signUpWithPassword(
  email: string,
  password: string,
): Promise<PasswordSignUp> {
  if (!supabaseConfigured())
    return { ok: false, message: "Sign-up isn't set up yet." };
  const base = process.env.SUPABASE_URL!.replace(/\/+$/, "");
  let res: Response;
  try {
    res = await fetch(`${base}/auth/v1/signup`, {
      method: "POST",
      headers: {
        apikey: process.env.SUPABASE_PUBLISHABLE_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { ok: false, message: explainSignUp(0, undefined) };
  }
  const body = (await res.json().catch(() => undefined)) as
    | {
        access_token?: unknown;
        refresh_token?: unknown;
        expires_in?: unknown;
        error_code?: unknown;
      }
    | undefined;
  if (!res.ok)
    return {
      ok: false,
      message: explainSignUp(
        res.status,
        typeof body?.error_code === "string" ? body.error_code : undefined,
      ),
    };
  const token = body?.access_token;
  if (typeof token === "string" && token.split(".").length === 3) {
    const expires = body?.expires_in;
    return {
      ok: true,
      session: {
        ok: true,
        token,
        refreshToken:
          typeof body?.refresh_token === "string" && body.refresh_token
            ? body.refresh_token
            : undefined,
        expiresInSeconds:
          typeof expires === "number" && expires > 0
            ? Math.floor(expires)
            : 3600,
      },
    };
  }
  return { ok: true };
}
