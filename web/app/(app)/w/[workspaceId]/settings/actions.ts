"use server";

import { revalidatePath } from "next/cache";
import { api, unwrapEmpty } from "@/lib/server/api";
import { attempt, type FormState } from "@/lib/server/actions-util";
import { isUuid } from "@/lib/text";

export async function saveSettingsAction(
  workspaceId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!isUuid(workspaceId))
    return { error: "That link is not valid. Go back and try again." };
  const publicSlug = String(formData.get("publicSlug") ?? "")
    .trim()
    .toLowerCase();
  const senderName = String(formData.get("senderName") ?? "").trim();
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).PUT("/v1/workspaces/{workspaceId}/settings", {
        params: { path: { workspaceId } },
        body: { publicSlug, senderName },
      }),
    ),
  );
  if (!res.ok) return res.state;
  revalidatePath(`/w/${workspaceId}/settings`);
  return undefined;
}
