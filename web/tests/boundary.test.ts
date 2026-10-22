import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The web app is a client only: it must never import database or
// service-role code. Fails the build if someone adds one.
const FORBIDDEN = [
  /from\s+["'](pg|postgres|drizzle-orm|@prisma\/client|@supabase\/supabase-js)["']/,
  /SERVICE_ROLE/i,
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (["node_modules", ".next", "coverage"].includes(f)) return [];
    return statSync(p).isDirectory()
      ? files(p)
      : /\.(ts|tsx)$/.test(p) && !p.endsWith(".test.ts")
        ? [p]
        : [];
  });
}

describe("client/backend boundary", () => {
  it("imports no database or service-role code", () => {
    const offenders = files(".").filter((p) =>
      FORBIDDEN.some((re) => re.test(readFileSync(p, "utf8"))),
    );
    expect(offenders).toEqual([]);
  });
});
