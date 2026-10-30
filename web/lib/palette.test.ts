import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_RECENTS,
  addRecent,
  highlightParts,
  readRecents,
  searchScopes,
} from "./palette";

describe("highlightParts", () => {
  it("marks each searched word wherever it appears, ignoring case, and keeps all the text", () => {
    const parts = highlightParts("Single sign-on (SAML) for our team", "sign TEAM");
    expect(parts.map((p) => p.text).join("")).toBe("Single sign-on (SAML) for our team");
    expect(parts.filter((p) => p.match).map((p) => p.text)).toEqual(["sign", "team"]);
  });
  it("marks nothing for an empty or one-letter search", () => {
    expect(highlightParts("Audit log", "")).toEqual([{ text: "Audit log", match: false }]);
    expect(highlightParts("Audit log", "a")).toEqual([{ text: "Audit log", match: false }]);
  });
  it("treats punctuation in the search as plain text, never as a pattern", () => {
    const parts = highlightParts("What is (a+b)?", "(a+b)");
    expect(parts.map((p) => p.text).join("")).toBe("What is (a+b)?");
    expect(parts.filter((p) => p.match).map((p) => p.text)).toEqual(["(a+b)"]);
  });
  it("does not mark overlapping words twice", () => {
    const parts = highlightParts("exporting", "export port");
    expect(parts.map((p) => p.text).join("")).toBe("exporting");
  });
});

describe("recent items", () => {
  const ws = "11111111-1111-4111-8111-111111111111";
  const store = new Map<string, string>();
  const fake = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  afterEach(() => {
    store.clear();
    vi.unstubAllGlobals();
  });
  const use = (ls: unknown) => vi.stubGlobal("window", { localStorage: ls });

  it("remembers the newest first, once each, up to a small cap", () => {
    use(fake);
    for (let i = 0; i < MAX_RECENTS + 3; i++)
      addRecent(ws, { href: `/w/${ws}/requests/${i}`, label: `R${i}`, kind: "request" });
    addRecent(ws, { href: `/w/${ws}/requests/5`, label: "R5", kind: "request" });
    const got = readRecents(ws);
    expect(got).toHaveLength(MAX_RECENTS);
    expect(got[0].label).toBe("R5");
    expect(new Set(got.map((r) => r.href)).size).toBe(got.length);
  });

  it("keeps each workspace's list apart", () => {
    use(fake);
    const other = "22222222-2222-4222-8222-222222222222";
    addRecent(ws, { href: `/w/${ws}/quotes`, label: "Quotes", kind: "page" });
    expect(readRecents(other)).toEqual([]);
  });

  it("ignores corrupted storage and links that leave the workspace", () => {
    use(fake);
    store.set(`palette:v1:${ws}`, "{not json");
    expect(readRecents(ws)).toEqual([]);
    store.set(
      `palette:v1:${ws}`,
      JSON.stringify([
        { href: "https://evil.example/", label: "x", kind: "page" },
        { href: `/w/${ws}/people`, label: "People", kind: "page" },
        { href: `/w/${ws}/people`, label: 5, kind: "page" },
      ]),
    );
    expect(readRecents(ws).map((r) => r.label)).toEqual(["People"]);
  });

  it("works when storage is blocked", () => {
    const blocked = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {},
    };
    use(blocked);
    expect(readRecents(ws)).toEqual([]);
    expect(() => addRecent(ws, { href: `/w/${ws}/quotes`, label: "Quotes", kind: "page" })).not.toThrow();
  });
});

describe("searchScopes", () => {
  it("only searches what the workspace has, and always people and companies", () => {
    expect(searchScopes(["people", "quality", "settings"])).toEqual({
      quotes: false, requests: false, findings: false, people: true, companies: true,
    });
    expect(searchScopes(["quotes", "requests", "findings", "people"])).toEqual({
      quotes: true, requests: true, findings: true, people: true, companies: true,
    });
  });
});
