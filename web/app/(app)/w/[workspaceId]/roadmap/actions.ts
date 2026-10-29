"use server";

import { revalidatePath } from "next/cache";
import { api, unwrap, unwrapEmpty } from "@/lib/server/api";
import { attempt } from "@/lib/server/actions-util";
import { isUuid } from "@/lib/text";

const BAD_LINK = "That link is not valid. Go back and try again.";

/** Saves the manual order of one column. The API checks the role and the ids. */
export async function reorderRoadmap(
  workspaceId: string,
  ids: string[],
): Promise<{ error?: string }> {
  if (!isUuid(workspaceId)) return { error: BAD_LINK };
  if (ids.some((id) => !isUuid(id))) return { error: BAD_LINK };
  if (ids.length === 0) return {};
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).PUT("/v1/workspaces/{workspaceId}/roadmap/order", {
        params: { path: { workspaceId } },
        body: { ids },
      }),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  revalidatePath(`/w/${workspaceId}/roadmap`);
  return {};
}

/**
 * Moves a card to another stage. This is the same status change the request page
 * makes, but it does not navigate: the board shows a message instead, because a
 * drag should never pull someone off the roadmap.
 */
export async function moveRoadmapCard(
  workspaceId: string,
  requestId: string,
  statusId: string,
): Promise<{ error?: string; notice?: string; batchId?: string }> {
  if (!isUuid(workspaceId) || !isUuid(requestId) || !isUuid(statusId))
    return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).PUT("/v1/workspaces/{workspaceId}/requests/{requestId}/status", {
        params: { path: { workspaceId, requestId } },
        body: { statusId },
      }),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  revalidatePath(`/w/${workspaceId}/roadmap`);
  revalidatePath(`/w/${workspaceId}/requests/${requestId}`);
  const c = res.value;
  if (c.shipped) {
    const why = [
      c.noEmail > 0
        ? `${c.noEmail} ${c.noEmail === 1 ? "person has" : "people have"} no email address`
        : "",
      c.suppressed > 0 ? `${c.suppressed} asked not to be emailed` : "",
      c.anonymousQuotes > 0
        ? "some quotes are from someone we haven't recorded"
        : "",
    ]
      .filter(Boolean)
      .join("; ");
    return {
      notice: c.batchId
        ? "Moved to shipped. Personal drafts are ready for review."
        : `Moved to shipped. There is nobody to write to${why ? `: ${why}` : ""}.`,
      batchId: c.batchId,
    };
  }
  return { notice: "Stage updated." };
}
