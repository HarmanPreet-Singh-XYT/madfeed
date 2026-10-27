import "server-only";
import { cookies } from "next/headers";
import { mockFetch } from "./engine";
import "./handlers";

// Stands in for lib/server/transport.ts in a preview build: the app talks to sample data in memory instead of
// the API, and always has a signed-in demo person (unless the visitor picked the signed-out view in /mock).

export const apiBase = "http://mock.invalid";
export const apiFetch: typeof fetch = mockFetch;
export const sessionToken: () => Promise<string | undefined> = async () => {
  try {
    return (await cookies()).get("mock_session")?.value === "out"
      ? undefined
      : "mock.session.token";
  } catch {
    return "mock.session.token";
  }
};
