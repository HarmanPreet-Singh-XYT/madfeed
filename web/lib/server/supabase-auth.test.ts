import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  requestPasswordReset,
  updatePassword,
  verifyRecovery,
  signInWithPassword,
  signUpWithPassword,
  supabaseConfigured,
} from "./supabase-auth";

const jwt = "aaa.bbb.ccc";

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", "https://proj.supabase.co/");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_x");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("password sign-in", () => {
  it("is off until both settings exist", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    expect(supabaseConfigured()).toBe(false);
    expect(await signInWithPassword("a@b.co", "pw")).toMatchObject({
      ok: false,
    });
  });

  it("sends the publishable key and credentials, and nothing else", async () => {
    const f = respond(200, { access_token: jwt, expires_in: 1800 });
    vi.stubGlobal("fetch", f);
    const r = await signInWithPassword("a@b.co", "s3cret");
    expect(r).toEqual({ ok: true, token: jwt, expiresInSeconds: 1800 });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      "https://proj.supabase.co/auth/v1/token?grant_type=password",
    );
    const headers = init.headers as Record<string, string>;
    expect(headers.apikey).toBe("sb_publishable_x");
    expect(headers.Authorization).toBeUndefined();
    expect(JSON.parse(init.body as string)).toEqual({
      email: "a@b.co",
      password: "s3cret",
    });
    expect(init.cache).toBe("no-store");
  });

  it("defaults the lifetime and rejects tokens that are not JWTs", async () => {
    vi.stubGlobal("fetch", respond(200, { access_token: jwt }));
    expect(await signInWithPassword("a@b.co", "pw")).toMatchObject({
      expiresInSeconds: 3600,
    });
    vi.stubGlobal("fetch", respond(200, { access_token: "not-a-jwt" }));
    expect(await signInWithPassword("a@b.co", "pw")).toMatchObject({
      ok: false,
    });
    vi.stubGlobal("fetch", respond(200, {}));
    expect(await signInWithPassword("a@b.co", "pw")).toMatchObject({
      ok: false,
    });
  });

  it("explains failures in plain words and never repeats the service's text", async () => {
    const cases: [number, unknown, RegExp][] = [
      [
        400,
        {
          error_code: "invalid_credentials",
          msg: "Invalid login credentials for user 42",
        },
        /don't match/,
      ],
      [
        400,
        { error_code: "user_not_found", msg: "no such user a@b.co" },
        /don't match/,
      ], // same words: no account probing
      [400, { error_code: "email_not_confirmed" }, /Confirm your email/],
      [429, { error_code: "over_request_rate_limit" }, /Too many attempts/],
      [500, { msg: "database exploded at 10.0.0.5" }, /try again in a moment/],
    ];
    for (const [status, body, want] of cases) {
      vi.stubGlobal("fetch", respond(status, body));
      const r = await signInWithPassword("a@b.co", "pw");
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.message).toMatch(want);
        expect(r.message).not.toMatch(/exploded|10\.0\.0\.5|user 42|a@b\.co/);
      }
    }
  });

  it("survives a dead network and a non-JSON reply", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    expect(await signInWithPassword("a@b.co", "pw")).toMatchObject({
      ok: false,
      message: expect.stringMatching(/try again/),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("<html>bad gateway</html>", { status: 502 }),
      ),
    );
    expect(await signInWithPassword("a@b.co", "pw")).toMatchObject({
      ok: false,
      message: expect.stringMatching(/try again/),
    });
  });
});

describe("sign-up", () => {
  it("is off until both settings exist", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    expect(await signUpWithPassword("a@b.co", "long enough pw")).toMatchObject({
      ok: false,
    });
  });

  it("sends only the publishable key, the address and the password", async () => {
    const f = respond(200, { id: "u", email: "a@b.co" });
    vi.stubGlobal("fetch", f);
    const r = await signUpWithPassword("a@b.co", "long enough pw");
    expect(r).toEqual({ ok: true });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://proj.supabase.co/auth/v1/signup");
    const headers = init.headers as Record<string, string>;
    expect(headers.apikey).toBe("sb_publishable_x");
    expect(headers.Authorization).toBeUndefined();
    expect(JSON.parse(init.body as string)).toEqual({
      email: "a@b.co",
      password: "long enough pw",
    });
  });

  it("returns the session when the project does not ask for confirmation", async () => {
    vi.stubGlobal(
      "fetch",
      respond(200, { access_token: jwt, refresh_token: "r", expires_in: 900 }),
    );
    expect(await signUpWithPassword("a@b.co", "long enough pw")).toEqual({
      ok: true,
      session: {
        ok: true,
        token: jwt,
        refreshToken: "r",
        expiresInSeconds: 900,
      },
    });
  });

  it("explains failures in plain words and never repeats what the service said", async () => {
    for (const [status, code, expected] of [
      [422, "weak_password", /stronger password/],
      [422, "signup_disabled", /can't be created right now/],
      [400, "email_address_invalid", /doesn't look right/],
      [429, "over_email_send_rate_limit", /Too many attempts/],
      [500, "unexpected_failure", /couldn't create your account/],
    ] as const) {
      vi.stubGlobal(
        "fetch",
        respond(status, { error_code: code, msg: "SECRET INTERNAL TEXT" }),
      );
      const r = await signUpWithPassword("a@b.co", "long enough pw");
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.message).toMatch(expected);
        expect(r.message).not.toContain("SECRET");
      }
    }
  });

  it("treats a network failure as a plain failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("down");
      }),
    );
    expect(await signUpWithPassword("a@b.co", "long enough pw")).toMatchObject({
      ok: false,
    });
  });
});

describe("password reset", () => {
  it("gives the same answer for an address with an account and one without", async () => {
    const f = respond(200, {});
    vi.stubGlobal("fetch", f);
    expect(await requestPasswordReset("known@b.co")).toEqual({ ok: true });
    expect(await requestPasswordReset("nobody@b.co")).toEqual({ ok: true });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://proj.supabase.co/auth/v1/recover");
    expect(JSON.parse(init.body as string)).toEqual({ email: "known@b.co" });
  });

  it("tells a person to wait when rate limited, and never shows upstream text", async () => {
    vi.stubGlobal("fetch", respond(429, { msg: "internal detail" }));
    const r = await requestPasswordReset("a@b.co");
    expect(r).toMatchObject({ ok: false });
    expect(JSON.stringify(r)).not.toContain("internal detail");
  });

  it("trades the emailed code for a session, and says so plainly when it is spent", async () => {
    const f = respond(200, {
      access_token: jwt,
      refresh_token: "r",
      expires_in: 900,
    });
    vi.stubGlobal("fetch", f);
    expect(await verifyRecovery("abcdefgh")).toEqual({
      ok: true,
      token: jwt,
      refreshToken: "r",
      expiresInSeconds: 900,
    });
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      type: "recovery",
      token_hash: "abcdefgh",
    });
    vi.stubGlobal("fetch", respond(403, { error_code: "otp_expired" }));
    expect(await verifyRecovery("abcdefgh")).toMatchObject({
      ok: false,
      message: expect.stringContaining("expired"),
    });
  });

  it("sets the password with the person's own token", async () => {
    const f = respond(200, {});
    vi.stubGlobal("fetch", f);
    expect(await updatePassword(jwt, "a long enough one")).toEqual({
      ok: true,
    });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://proj.supabase.co/auth/v1/user");
    expect(init.method).toBe("PUT");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${jwt}`,
    );
    vi.stubGlobal("fetch", respond(422, { error_code: "weak_password" }));
    expect(await updatePassword(jwt, "short")).toMatchObject({ ok: false });
  });
});
