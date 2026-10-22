"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { api, unwrap, unwrapEmpty } from "@/lib/server/api";
import { attempt, type FormState } from "@/lib/server/actions-util";
import { isUuid } from "@/lib/text";

// Server actions are public endpoints: every one re-validates its inputs, and
// api() refuses to run without a session. The API then checks membership and
// role again; nothing here is trusted on its own.

const bad: FormState = {
  error: "That link is not valid. Go back and try again.",
};

export async function pasteAction(
  workspaceId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!isUuid(workspaceId)) return bad;
  const text = String(formData.get("text") ?? "");
  if (!text.trim()) return { error: "Paste a conversation first." };
  const title = String(formData.get("title") ?? "").trim();
  const originUrl = String(formData.get("originUrl") ?? "").trim();
  const personId = String(formData.get("personId") ?? "");
  if (personId && !isUuid(personId)) return bad;
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/sources/paste", {
        params: { path: { workspaceId } },
        body: {
          text,
          ...(title ? { title } : {}),
          ...(originUrl ? { originUrl } : {}),
          ...(personId ? { personId } : {}),
        },
      }),
    ),
  );
  if (!res.ok) return res.state;
  redirect(`/w/${workspaceId}/sources/${res.value.sourceItemId}`);
}

function refresh(workspaceId: string) {
  revalidatePath(`/w/${workspaceId}/review`);
  revalidatePath(`/w/${workspaceId}/requests`);
}

export async function acceptAction(
  workspaceId: string,
  proposalId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!isUuid(workspaceId) || !isUuid(proposalId)) return bad;
  const title = String(formData.get("title") ?? "").trim();
  const targetRequestId = String(formData.get("targetRequestId") ?? "");
  if (targetRequestId && !isUuid(targetRequestId)) return bad;
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/proposals/{proposalId}/accept", {
        params: { path: { workspaceId, proposalId } },
        // Adding to an existing request keeps that request's title.
        body: targetRequestId ? { targetRequestId } : title ? { title } : {},
      }),
    ),
  );
  if (!res.ok) return res.state;
  refresh(workspaceId);
  return undefined;
}

export async function dismissAction(
  workspaceId: string,
  proposalId: string,
): Promise<FormState> {
  if (!isUuid(workspaceId) || !isUuid(proposalId)) return bad;
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/proposals/{proposalId}/dismiss", {
        params: { path: { workspaceId, proposalId } },
      }),
    ),
  );
  if (!res.ok) return res.state;
  refresh(workspaceId);
  return undefined;
}

export async function undoAction(
  workspaceId: string,
  proposalId: string,
): Promise<FormState> {
  if (!isUuid(workspaceId) || !isUuid(proposalId)) return bad;
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/proposals/{proposalId}/undo", {
        params: { path: { workspaceId, proposalId } },
      }),
    ),
  );
  if (!res.ok) return res.state;
  refresh(workspaceId);
  return undefined;
}

export async function bulkAcceptAction(
  workspaceId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!isUuid(workspaceId)) return bad;
  const threshold = Number(formData.get("threshold"));
  if (!(threshold >= 0.5 && threshold <= 1))
    return { error: "Choose a confidence level between 50% and 100%." };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/proposals/bulk-accept", {
        params: { path: { workspaceId } },
        body: { threshold },
      }),
    ),
  );
  if (!res.ok) return res.state;
  refresh(workspaceId);
  return { error: undefined };
}
