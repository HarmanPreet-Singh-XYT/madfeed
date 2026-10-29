import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// The rules that keep the preview build from spreading into the real app. They are checked by reading the
// source, so breaking one fails the tests, not a code review.

const root = join(__dirname, "..");
const skip = new Set([
  "node_modules",
  ".next",
  ".next-preview",
  ".preview-check",
  "test-results",
  "playwright-report",
  "public",
]);

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(ts|tsx|mts|js|mjs)$/.test(name) && !name.endsWith(".gen.d.ts"))
      out.push(p);
  }
  return out;
}
const all = files(root).map((p) => ({
  path: relative(root, p),
  text: readFileSync(p, "utf8"),
}));
const real = all.filter(
  (f) =>
    !f.path.startsWith("mock/") &&
    !f.path.startsWith("app/mock/") &&
    f.path !== "next.config.ts" &&
    !f.path.startsWith("e2e/"),
);
const swapped = [
  "lib/server/transport",
  "lib/server/preview",
  "components/preview-badge",
];

describe("the preview build stays out of the real app", () => {
  it("reads MOCK_UI in next.config.ts and nowhere else", () => {
    const users = all.filter(
      (f) =>
        f.text.includes("MOCK_UI") &&
        f.path !== "next.config.ts" &&
        f.path !== "mock/rules.test.ts" &&
        !f.path.startsWith("playwright"),
    );
    expect(users.map((f) => f.path)).toEqual([]);
  });

  it("is never imported by the real app", () => {
    const bad = real.filter((f) =>
      /from\s+["'](@\/mock|\.{1,2}\/(\.\.\/)*mock)(\/|["'])/.test(f.text),
    );
    expect(bad.map((f) => f.path)).toEqual([]);
  });

  it("swapped modules are always imported by their full name, which is what the swap matches", () => {
    const bad: string[] = [];
    for (const f of all) {
      for (const m of swapped) {
        const base = m.split("/").pop()!;
        const relativeImport = new RegExp(
          `from\\s+["']\\.{1,2}/(?:[\\w-]+/)*${base}["']`,
        );
        const own =
          f.path === `${m}.ts` ||
          f.path === `${m}.tsx` ||
          f.path === `mock/${base}.ts` ||
          f.path === `mock/${base}.tsx` ||
          f.path === "mock/alias-check.ts";
        if (!own && relativeImport.test(f.text))
          bad.push(`${f.path} imports ${base} by a relative path`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("has a stand-in for every swapped module, and the compiler checks they match", () => {
    for (const m of swapped) {
      const base = m.split("/").pop()!;
      expect(
        all.some(
          (f) => f.path === `mock/${base}.ts` || f.path === `mock/${base}.tsx`,
        ),
        base,
      ).toBe(true);
    }
    const check = all.find((f) => f.path === "mock/alias-check.ts")!;
    for (const m of swapped) expect(check.text).toContain(`@/${m}`);
  });

  it("keeps page and component code free of preview checks", () => {
    const bad = real.filter((f) =>
      /previewMode|isPreview|isMock|process\.env\.MOCK/.test(f.text),
    );
    expect(bad.map((f) => f.path)).toEqual([]);
  });
});
