import { describe, expect, it } from "vitest";
import { safeNext } from "./next-path";

describe("safeNext", () => {
  it("allows a public roadmap page", () => {
    expect(safeNext("/r/acme-co/roadmap")).toBe("/r/acme-co/roadmap");
  });
  it("sends everything else home", () => {
    for (const bad of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "/r/acme/roadmap/../../x",
      "/r/acme-co/roadmap?x=1",
      "/w/123/settings",
      "javascript:alert(1)",
      "",
      undefined,
      42,
      null,
    ]) {
      expect(safeNext(bad)).toBe("/");
    }
  });
});
