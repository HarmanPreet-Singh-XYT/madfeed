import { describe, expect, it } from "vitest";
import { clientIp } from "./client-ip";

describe("clientIp", () => {
  it("trusts nothing when no proxy of ours is in front", () => {
    expect(clientIp("203.0.113.9", 0)).toBeUndefined();
    expect(clientIp("203.0.113.9", -1)).toBeUndefined();
  });
  it("takes the entry just before our own proxies", () => {
    expect(clientIp("203.0.113.9", 1)).toBe("203.0.113.9");
    expect(clientIp("6.6.6.6, 203.0.113.9", 1)).toBe("203.0.113.9"); // the left part is whatever the visitor claimed
    expect(clientIp("203.0.113.9, 10.0.0.2", 2)).toBe("203.0.113.9");
    expect(clientIp("2001:db8::1", 1)).toBe("2001:db8::1");
  });
  it("gives no answer for junk or too few entries", () => {
    expect(clientIp(undefined, 1)).toBeUndefined();
    expect(clientIp("", 1)).toBeUndefined();
    expect(clientIp("not-an-ip", 1)).toBeUndefined();
    expect(clientIp("203.0.113.9", 2)).toBeUndefined();
  });
});
