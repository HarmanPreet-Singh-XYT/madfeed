import "server-only";
import { ApiError } from "./api";

export type FormState = { error?: string } | undefined;

/**
 * Runs a mutation and turns an ApiError into form state a person can read.
 * Redirects (which are thrown) pass through untouched because they are not
 * ApiErrors.
 */
export async function attempt<T>(
  fn: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; state: FormState }> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    if (e instanceof ApiError)
      return { ok: false, state: { error: e.message } };
    throw e; // includes Next.js redirects, which must keep propagating
  }
}
