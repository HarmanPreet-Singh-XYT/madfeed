import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

// Which API operations the preview answers. Operations that have no screen (health checks, the key-authenticated
// /v1/ext routes for other programs) never need sample data; anything else not listed in `later` fails the test,
// so a new endpoint cannot be forgotten.
const noScreen = [/^GET \/(healthz|readyz)$/, /^\w+ \/v1\/ext\//];
const later: RegExp[] = [];

function operations(): string[] {
  const text = readFileSync(join(__dirname, "../../api/openapi.yaml"), "utf8");
  const start = text.indexOf("\npaths:");
  const end = text.indexOf("\ncomponents:", start);
  const out: string[] = [];
  let path = "";
  for (const line of text.slice(start, end).split("\n")) {
    const p = /^ {2}(\/\S+):\s*$/.exec(line);
    if (p) path = p[1];
    const m = /^ {4}(get|post|put|patch|delete):\s*$/.exec(line);
    if (m && path) out.push(`${m[1].toUpperCase()} ${path}`);
  }
  return out;
}

describe("preview coverage", () => {
  it("answers every operation that has a screen", async () => {
    await import("./handlers");
    const { mockedRoutes } = await import("./engine");
    const have = new Set(mockedRoutes());
    const ops = operations();
    expect(ops.length).toBeGreaterThan(200);
    const missing = ops.filter(
      (o) =>
        !have.has(o) &&
        !noScreen.some((r) => r.test(o)) &&
        !later.some((r) => r.test(o)),
    );
    writeFileSync("/tmp/unmocked.txt", missing.join("\n"));
    expect(missing).toEqual([]);
  });
});
