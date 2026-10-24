"use server";

import { api, unwrap } from "@/lib/server/api";
import { attempt } from "@/lib/server/actions-util";
import { isUuid } from "@/lib/text";

export type AuthorizeState =
  { error?: string; redirectUrl?: string } | undefined;

const SCOPES = ["requests", "quotes", "ask", "submit", "write"] as const;
const FIELD = /^[A-Za-z0-9_.~-]{1,200}$/;

/** Sends the person's answer (approve or refuse) to the API, which checks everything again. */
export async function authorizeAction(
  _prev: AuthorizeState,
  formData: FormData,
): Promise<AuthorizeState> {
  const approve = formData.get("decision") === "approve";
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const clientId = String(formData.get("client_id") ?? "");
  const redirectUri = String(formData.get("redirect_uri") ?? "");
  const challenge = String(formData.get("code_challenge") ?? "");
  const state = String(formData.get("state") ?? "");
  const resource = String(formData.get("resource") ?? "");
  if (!isUuid(workspaceId))
    return { error: "Choose which workspace the assistant may use." };
  if (!FIELD.test(clientId) || !redirectUri || !FIELD.test(challenge))
    return {
      error: "This request is incomplete. Start again from the assistant.",
    };
  const scopes = SCOPES.filter((s) => formData.get(`scope-${s}`) === "on");
  if (approve && scopes.length === 0)
    return { error: "Choose at least one thing the assistant may do." };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST("/v1/oauth/authorize", {
        body: {
          clientId,
          workspaceId,
          redirectUri,
          codeChallenge: challenge,
          codeChallengeMethod: "S256",
          // a refusal still names a valid permission so the API can check the rest of the request
          scopes: scopes.length > 0 ? scopes : ["requests"],
          ...(state ? { state } : {}),
          ...(resource ? { resource } : {}),
          approve,
        },
      }),
    ),
  );
  if (!res.ok) return res.state;
  return { redirectUrl: res.value.redirectUrl };
}
