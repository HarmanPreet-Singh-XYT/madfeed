"use server";

import { revalidatePath } from "next/cache";
import { api, unwrap, unwrapEmpty } from "@/lib/server/api";
import { attempt, type FormState } from "@/lib/server/actions-util";
import { isUuid } from "@/lib/text";

const BAD_LINK = "That link is not valid. Go back and try again.";

export async function setSentimentAction(
  workspaceId: string,
  kind: "evidence" | "highlight",
  quoteId: string,
  label: "positive" | "neutral" | "negative" | "mixed" | "none",
): Promise<FormState> {
  if (!isUuid(workspaceId) || !isUuid(quoteId)) return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).PUT(
        "/v1/workspaces/{workspaceId}/quotes/{quoteKind}/{quoteId}/sentiment",
        {
          params: { path: { workspaceId, quoteKind: kind, quoteId } },
          body: { label },
        },
      ),
    ),
  );
  if (!res.ok) return res.state;
  revalidatePath(`/w/${workspaceId}/quotes`);
  return undefined;
}

export async function classifyAction(
  workspaceId: string,
): Promise<{ error?: string; message?: string }> {
  if (!isUuid(workspaceId)) return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/sentiment/classify", {
        params: { path: { workspaceId } },
      }),
    ),
  );
  if (!res.ok) return res.state ?? {};
  revalidatePath(`/w/${workspaceId}/quotes/trends`);
  return {
    message:
      res.value.pending === 0
        ? "Every quote already has a label."
        : `Started. The model will label up to 200 of the ${res.value.pending} quotes that have no label; it can take a few minutes.`,
  };
}
