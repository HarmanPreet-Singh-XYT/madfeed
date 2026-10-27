import { cookies } from "next/headers";
import { getStore, type Store } from "./store";

// A tiny router that answers the web app's API calls from memory. Handlers are registered per method and path
// pattern (the same {names} the API contract uses), in mock/handlers/*.

export type Ctx = {
  params: Record<string, string>;
  query: URLSearchParams;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  headers: Headers;
  /** The size of an uploaded piece of a file (its bytes are not kept). */
  uploadedBytes: number;
  s: Store;
};
type Handler = (c: Ctx) => unknown;

export class MockError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const created = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  });
export const noContent = () => new Response(null, { status: 204 });
export const notFound = (what = "That") =>
  new MockError(404, "not_found", `${what} was not found.`);

type Route = { method: string; re: RegExp; names: string[]; handler: Handler };
// Keyed by method and pattern, so a hot reload replaces a handler instead of adding a second one.
const routes = new Map<string, Route>();

export function on(method: string, pattern: string, handler: Handler): void {
  const names: string[] = [];
  const re = new RegExp(
    "^" +
      pattern.replace(/\{(\w+)\}/g, (_, n: string) => {
        names.push(n);
        return "([^/]+)";
      }) +
      "$",
  );
  routes.set(`${method} ${pattern}`, { method, re, names, handler });
}

/** The visitor's chosen scenario (set from /mock): normal, empty, slow or failing. */
export async function scenario(): Promise<string> {
  try {
    return (await cookies()).get("mock_scenario")?.value ?? "";
  } catch {
    return ""; // not inside a request (a build step): the normal scenario
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const error = (status: number, code: string, message: string) =>
  json({ error: { code, message, requestId: "mock-request" } }, status);

const warned = new Set<string>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const mockFetch: typeof fetch = async (input, init) => {
  const req = input instanceof Request ? input : new Request(input, init);
  const url = new URL(req.url);
  const method = req.method.toUpperCase();
  const sc = await scenario();
  const base = Number(process.env.MOCK_LATENCY_MS ?? 140);
  await sleep(sc === "slow" ? 1800 : base);
  if (sc === "error" && url.pathname.startsWith("/v1/workspaces/"))
    return error(500, "internal", "Something went wrong. Please try again.");

  for (const r of routes.values()) {
    if (r.method !== method) continue;
    const m = r.re.exec(url.pathname);
    if (!m) continue;
    const params: Record<string, string> = {};
    r.names.forEach((n, i) => (params[n] = decodeURIComponent(m[i + 1])));
    let body: unknown;
    let uploadedBytes = 0;
    if (method !== "GET" && method !== "HEAD" && method !== "DELETE") {
      if ((req.headers.get("content-type") ?? "").includes("octet-stream"))
        uploadedBytes = (await req.arrayBuffer()).byteLength;
      else
        body = await req
          .clone()
          .json()
          .catch(() => undefined);
    }
    try {
      const out = r.handler({
        headers: req.headers,
        uploadedBytes,
        params,
        query: url.searchParams,
        body,
        s: await getStore(sc),
      });
      const res =
        out instanceof Response
          ? out
          : out === undefined
            ? noContent()
            : json(out);
      return res;
    } catch (e) {
      if (e instanceof MockError) return error(e.status, e.code, e.message);
      throw e;
    }
  }
  const key = `${method} ${url.pathname}`;
  if (!warned.has(key)) {
    warned.add(key);
    console.warn(`[mock] not mocked yet: ${key}`);
  }
  return error(
    501,
    "not_mocked",
    `This screen needs sample data that has not been added yet (${method} ${url.pathname.replace(/[0-9a-f-]{36}/g, ":id")}).`,
  );
};

/** Every "METHOD /path/{pattern}" the preview answers, for the coverage test. */
export function mockedRoutes(): string[] {
  return [...routes.keys()];
}
