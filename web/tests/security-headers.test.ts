import { describe, expect, it } from "vitest";
import config from "../next.config";

describe("security headers", () => {
  it("are applied to all routes", async () => {
    const rules = (await config.headers?.()) ?? [];
    const keys = rules.flatMap((r) => r.headers.map((h) => h.key));
    for (const k of [
      "X-Content-Type-Options",
      "Content-Security-Policy",
      "Strict-Transport-Security",
      "Referrer-Policy",
    ]) {
      expect(keys).toContain(k);
    }
    expect(config.poweredByHeader).toBe(false);
  });
});
