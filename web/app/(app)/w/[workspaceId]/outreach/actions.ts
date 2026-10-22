"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { api, unwrap, unwrapEmpty } from "@/lib/server/api";
import { attempt, type FormState } from "@/lib/server/actions-util";
import { isUuid } from "@/lib/text";

const bad: FormState = {
  error: "That link is not valid. Go back and try again.",
};

function refresh(workspaceId: string, batchId?: string) {
  revalidatePath(`/w/${workspaceId}/outreach`);
  if (batchId) revalidatePath(`/w/${workspaceId}/outreach/${batchId}`);
}

export async function saveMessageAction(
  workspaceId: string,
  batchId: string,
  messageId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (![workspaceId, batchId, messageId].every(isUuid)) return bad;
  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!subject || !body)
    return { error: "A message needs a subject and some text." };
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).PUT("/v1/workspaces/{workspaceId}/outreach/messages/{messageId}", {
        params: { path: { workspaceId, messageId } },
        body: { subject, body },
      }),
    ),
  );
  if (!res.ok) return res.state;
  refresh(workspaceId, batchId);
  return undefined;
}

type Toggle = "exclude" | "include" | "retry";

export async function messageActionFor(
  kind: Toggle,
  workspaceId: string,
  batchId: string,
  messageId: string,
): Promise<FormState> {
  if (![workspaceId, batchId, messageId].every(isUuid)) return bad;
  const client = await api();
  const path = { workspaceId, messageId };
  const res = await attempt(async () => {
    if (kind === "exclude")
      return unwrapEmpty(
        await client.POST(
          "/v1/workspaces/{workspaceId}/outreach/messages/{messageId}/exclude",
          { params: { path } },
        ),
      );
    if (kind === "include")
      return unwrapEmpty(
        await client.POST(
          "/v1/workspaces/{workspaceId}/outreach/messages/{messageId}/include",
          { params: { path } },
        ),
      );
    return unwrapEmpty(
      await client.POST(
        "/v1/workspaces/{workspaceId}/outreach/messages/{messageId}/retry",
        { params: { path } },
      ),
    );
  });
  if (!res.ok) return res.state;
  refresh(workspaceId, batchId);
  return undefined;
}

export async function excludeAction(
  workspaceId: string,
  batchId: string,
  messageId: string,
): Promise<FormState> {
  return messageActionFor("exclude", workspaceId, batchId, messageId);
}
export async function includeAction(
  workspaceId: string,
  batchId: string,
  messageId: string,
): Promise<FormState> {
  return messageActionFor("include", workspaceId, batchId, messageId);
}
export async function retryAction(
  workspaceId: string,
  batchId: string,
  messageId: string,
): Promise<FormState> {
  return messageActionFor("retry", workspaceId, batchId, messageId);
}

/** The one action that lets email leave. The API checks the role and the batch state again. */
export async function approveAction(
  workspaceId: string,
  batchId: string,
): Promise<FormState> {
  if (![workspaceId, batchId].every(isUuid)) return bad;
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/outreach/{batchId}/approve", {
        params: { path: { workspaceId, batchId } },
      }),
    ),
  );
  if (!res.ok) return res.state;
  refresh(workspaceId, batchId);
  return undefined;
}

export async function cancelAction(
  workspaceId: string,
  batchId: string,
): Promise<FormState> {
  if (![workspaceId, batchId].every(isUuid)) return bad;
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/outreach/{batchId}/cancel", {
        params: { path: { workspaceId, batchId } },
      }),
    ),
  );
  if (!res.ok) return res.state;
  refresh(workspaceId);
  redirect(`/w/${workspaceId}/outreach`);
}
