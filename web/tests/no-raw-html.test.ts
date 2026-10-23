import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Our content security policy allows inline scripts (the pages' shells are
// prerendered), so what keeps injected markup out is that nothing here ever
// writes raw HTML. This fails the build if someone adds a way to.
const FORBIDDEN = [
  /dangerouslySetInnerHTML/,
  /\.innerHTML\s*=/,
  /\.outerHTML\s*=/,
  /insertAdjacentHTML/,
  /document\.write\s*\(/,
  /\beval\s*\(/,
  /new\s+Function\s*\(/,
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (
      ["node_modules", ".next", "coverage", "e2e", "test-results"].includes(f)
    )
      return [];
    return statSync(p).isDirectory()
      ? files(p)
      : /\.(ts|tsx)$/.test(p) &&
          !/\.test\.tsx?$/.test(p) &&
          !p.endsWith(".gen.d.ts")
        ? [p]
        : [];
  });
}

describe("no raw HTML or dynamic code in the web app", () => {
  it("never injects markup or evaluates strings", () => {
    const offenders = files(".")
      .filter((p) => !p.startsWith("tests/"))
      .flatMap((p) =>
        FORBIDDEN.filter((re) => re.test(readFileSync(p, "utf8"))).map(
          (re) => `${p}: ${re}`,
        ),
      );
    expect(offenders).toEqual([]);
  });
});
