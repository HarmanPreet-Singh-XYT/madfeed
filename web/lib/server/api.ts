import "server-only";
import createClient from "openapi-fetch";
import { redirect } from "next/navigation";
import type { paths } from "@/lib/api/schema.gen";
import { getToken } from "./session";

// Server-side base URL; never exposed to the browser.
const baseUrl = process.env.API_URL ?? "http://127.0.0.1:8080";

/** An API failure with a message that is safe to show a person. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
  }
}

type ErrorBody =
  | { error?: { code?: string; message?: string; requestId?: string } }
  | undefined;

export function toApiError(status: number, body: unknown): ApiError {
  const e = (body as ErrorBody)?.error;
  return new ApiError(
    status,
    e?.code ?? "unknown",
    e?.message ?? "Something went wrong. Please try again.",
    e?.requestId,
  );
}

/**
 * An API client that sends the signed-in user's token. With no session it
 * redirects to the sign-in page, so callers can assume a token exists.
 */
export async function api() {
  const token = await getToken();
  if (!token) redirect("/login");
  return createClient<paths>({
    baseUrl,
    headers: { Authorization: `Bearer ${token}` },
  });
}

/**
 * Unwraps an openapi-fetch result: returns data, or throws ApiError. A 401
 * means the session is gone or expired, so we send the person to sign in.
 */
export function unwrap<T>(res: {
  data?: T;
  error?: unknown;
  response: Response;
}): T {
  if (res.response.ok && res.data !== undefined) return res.data;
  if (res.response.status === 401) redirect("/login");
  throw toApiError(res.response.status, res.error);
}

/** For endpoints that answer 204 No Content. */
export function unwrapEmpty(res: {
  error?: unknown;
  response: Response;
}): void {
  if (res.response.ok) return;
  if (res.response.status === 401) redirect("/login");
  throw toApiError(res.response.status, res.error);
}
