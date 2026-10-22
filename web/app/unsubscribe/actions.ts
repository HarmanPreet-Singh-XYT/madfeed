"use server";

import { publicApi, toApiError } from "@/lib/server/api";

// No session: this is reached from the link at the bottom of an email.
export async function confirmUnsubscribe(
  token: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!/^[A-Za-z0-9_-]{20,600}$/.test(token))
    return { ok: false, error: "This link isn't valid." };
  const res = await publicApi().POST("/v1/public/unsubscribe/{token}", {
    params: { path: { token } },
  });
  if (res.response.ok) return { ok: true };
  return {
    ok: false,
    error:
      res.response.status === 404
        ? "This link isn't valid."
        : toApiError(res.response.status, res.error).message,
  };
}
