import { describe, expect, it } from "vitest";
import { safeNext } from "./next-path";

describe("safeNext", () => {
  it("allows a public roadmap page", () => {
    expect(safeNext("/r/acme-co/roadmap")).toBe("/r/acme-co/roadmap");
  });
  it("keeps an assistant's approval request whole", () => {
    const q =
      "/oauth/authorize?client_id=oc_abc&redirect_uri=http%3A%2F%2F127.0.0.1%3A5%2Fcb&state=a+b";
    expect(safeNext(q)).toBe(q);
  });
  it("does not let the approval path be used to leave", () => {
    for (const bad of [
      "/oauth/authorize",
      "/oauth/authorize?",
      "/oauth/authorize/../../w/1",
      "/oauth/authorize?x=<script>",
      "/oauth/authorize?x=1#frag",
      "/oauth/authorizeevil?x=1",
      "//oauth/authorize?x=1",
    ]) {
      expect(safeNext(bad)).toBe("/");
    }
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
