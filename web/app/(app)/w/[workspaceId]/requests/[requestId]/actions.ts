"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { api, unwrap } from "@/lib/server/api";
import { attempt, type FormState } from "@/lib/server/actions-util";
import { isUuid } from "@/lib/text";

const BAD_LINK = "That link is not valid. Go back and try again.";
const bad: FormState = { error: BAD_LINK };

export async function requestBriefAction(
  workspaceId: string,
  requestId: string,
): Promise<FormState> {
  if (!isUuid(workspaceId) || !isUuid(requestId)) return bad;
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

export type StatusResult = { error?: string; notice?: string };

/**
 * Changes a request's status. Moving it to a shipped status prepares personal
 * message drafts; when there are people to write to we go straight to the page
 * where a person reviews them. Nothing is sent from here.
 */
export async function setStatusAction(
  workspaceId: string,
  requestId: string,
  statusId: string,
): Promise<StatusResult> {
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
  revalidatePath(`/w/${workspaceId}`, "layout");
  const c = res.value;
  if (c.shipped && c.batchId)
    redirect(`/w/${workspaceId}/outreach/${c.batchId}`);
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
      notice: `Marked as shipped. There is nobody to write to${why ? `: ${why}` : ""}.`,
    };
  }
  return { notice: "Status updated." };
}
