import { describe, expect, it } from "vitest";
import { afterEach, vi } from "vitest";
import { devAuthEnabled, devUserId, fetchDevToken } from "./dev-auth";
import { isUuid } from "../text";

describe("devUserId", () => {
  it("is stable, case-insensitive and shaped like a uuid", () => {
    expect(devUserId("Alice")).toBe(devUserId(" alice "));
    expect(devUserId("alice")).not.toBe(devUserId("bob"));
    expect(isUuid(devUserId("alice"))).toBe(true);
  });
});

describe("devAuthEnabled", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("is off by default", () => {
    vi.stubEnv("ENABLE_DEV_AUTH", "");
    expect(devAuthEnabled()).toBe(false);
  });
  it("turns on only when explicitly enabled", () => {
    vi.stubEnv("ENABLE_DEV_AUTH", "true");
    vi.stubEnv("APP_ENV", "development");
    expect(devAuthEnabled()).toBe(true);
  });
  it("is refused in production even if enabled", () => {
    vi.stubEnv("ENABLE_DEV_AUTH", "true");
    vi.stubEnv("APP_ENV", "production");
    expect(devAuthEnabled()).toBe(false);
  });
});

describe("fetchDevToken", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  it("asks the configured token service for that user", async () => {
    vi.stubEnv("ENABLE_DEV_AUTH", "true");
    vi.stubEnv("APP_ENV", "development");
    vi.stubEnv("DEV_AUTH_URL", "http://auth.test:9999");
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ token: "abc" }) });
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchDevToken("alice")).resolves.toBe("abc");
    expect(fetchMock.mock.calls[0][0]).toBe(
      `http://auth.test:9999/token?sub=${devUserId("alice")}`,
    );
  });
  it("refuses when dev auth is off", async () => {
    vi.stubEnv("ENABLE_DEV_AUTH", "");
    await expect(fetchDevToken("alice")).rejects.toThrow("not enabled");
  });
});
