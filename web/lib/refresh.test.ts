import { afterEach, describe, expect, it, vi } from "vitest";
import { refreshSession, secondsLeft } from "./refresh";

const jwt = (payload: object) =>
  `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s`;

afterEach(() => vi.unstubAllGlobals());

describe("secondsLeft", () => {
  it("reads the expiry", () => {
    const now = 1_000_000_000_000;
    expect(secondsLeft(jwt({ exp: now / 1000 + 50 }), now)).toBe(50);
    expect(secondsLeft(jwt({ exp: now / 1000 - 5 }), now)).toBe(-5);
  });
  it("gives up quietly on anything odd", () => {
    expect(secondsLeft("nonsense")).toBeUndefined();
    expect(secondsLeft("a.b.c")).toBeUndefined();
    expect(secondsLeft(jwt({}))).toBeUndefined();
    expect(secondsLeft(jwt({ exp: "soon" }))).toBeUndefined();
    expect(secondsLeft("")).toBeUndefined();
  });
});

describe("refreshSession", () => {
  const env = { url: "https://p.supabase.co/", key: "sb_publishable_x" };
  const ok = (body: unknown, status = 200) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it("sends only the publishable key and the refresh token", async () => {
    const f = ok({
      access_token: "a.b.c",
      refresh_token: "r2",
      expires_in: 900,
    });
    vi.stubGlobal("fetch", f);
    expect(await refreshSession("r1", env)).toEqual({
      token: "a.b.c",
      refreshToken: "r2",
      expiresInSeconds: 900,
    });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      "https://p.supabase.co/auth/v1/token?grant_type=refresh_token",
    );
    expect((init.headers as Record<string, string>).apikey).toBe(
      "sb_publishable_x",
    );
    expect(JSON.parse(init.body as string)).toEqual({ refresh_token: "r1" });
  });
  it("treats every failure as the end of the session", async () => {
    vi.stubGlobal("fetch", ok({ error_code: "refresh_token_not_found" }, 400));
    expect(await refreshSession("r1", env)).toBeUndefined();
    vi.stubGlobal("fetch", ok({ access_token: "bad", refresh_token: "r" }));
    expect(await refreshSession("r1", env)).toBeUndefined();
    vi.stubGlobal("fetch", ok({ access_token: "a.b.c" })); // no new refresh token
    expect(await refreshSession("r1", env)).toBeUndefined();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("down");
      }),
    );
    expect(await refreshSession("r1", env)).toBeUndefined();
    expect(await refreshSession("", env)).toBeUndefined();
    expect(await refreshSession("r1", {})).toBeUndefined();
  });
});
