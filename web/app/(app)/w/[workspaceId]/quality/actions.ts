"use server";

import { revalidatePath } from "next/cache";
import { api, unwrapEmpty } from "@/lib/server/api";
import { attempt } from "@/lib/server/actions-util";
import { isUuid } from "@/lib/text";

export async function reviewAuditAction(
  workspaceId: string,
  sampleId: string,
  verdict: "supported" | "not_supported",
  note: string,
): Promise<{ error?: string }> {
  if (!isUuid(workspaceId) || !isUuid(sampleId))
    return { error: "That link is not valid. Go back and try again." };
  if (verdict !== "supported" && verdict !== "not_supported")
    return { error: "Choose one of the two answers." };
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).PUT("/v1/workspaces/{workspaceId}/audit/{sampleId}", {
        params: { path: { workspaceId, sampleId } },
        body: { verdict, note: note.trim().slice(0, 500) },
      }),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  revalidatePath(`/w/${workspaceId}/quality`);
  return {};
}
