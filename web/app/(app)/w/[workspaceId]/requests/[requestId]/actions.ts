"use server";

import { revalidatePath } from "next/cache";
import { api, unwrap } from "@/lib/server/api";
import { attempt, type FormState } from "@/lib/server/actions-util";
import { isUuid } from "@/lib/text";

export async function requestBriefAction(
  workspaceId: string,
  requestId: string,
): Promise<FormState> {
  if (!isUuid(workspaceId) || !isUuid(requestId))
    return { error: "That link is not valid. Go back and try again." };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/requests/{requestId}/brief", {
        params: { path: { workspaceId, requestId } },
      }),
    ),
  );
  if (!res.ok) return res.state;
  revalidatePath(`/w/${workspaceId}/requests/${requestId}`);
  return undefined;
}
