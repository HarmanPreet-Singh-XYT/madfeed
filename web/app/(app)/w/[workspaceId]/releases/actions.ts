"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { api, unwrap, unwrapEmpty } from "@/lib/server/api";
import { attempt, type FormState } from "@/lib/server/actions-util";
import { isUuid } from "@/lib/text";
import { localToInstant } from "@/lib/time";

const BAD_LINK = "That link is not valid. Go back and try again.";
const bad: FormState = { error: BAD_LINK };

function refresh(workspaceId: string, noteId?: string) {
  revalidatePath(`/w/${workspaceId}/releases`);
  if (noteId) revalidatePath(`/w/${workspaceId}/releases/${noteId}`);
}

export async function createNoteAction(
  workspaceId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!isUuid(workspaceId)) return bad;
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { error: "Give the note a title." };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/release-notes", {
        params: { path: { workspaceId } },
        body: { title },
      }),
    ),
  );
  if (!res.ok) return res.state;
  refresh(workspaceId);
  redirect(`/w/${workspaceId}/releases/${res.value.id}`);
}

export async function saveNoteAction(
  workspaceId: string,
  noteId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!isUuid(workspaceId) || !isUuid(noteId)) return bad;
  const body = String(formData.get("body") ?? "");
  const kind = String(formData.get("type") ?? "");
  const requestIds = formData.getAll("requestIds").map(String);
  if (!requestIds.every(isUuid)) return bad;
  const client = await api();
  const res = await attempt(async () => {
    const current = unwrap(
      await client.GET("/v1/workspaces/{workspaceId}/release-notes/{noteId}", {
        params: { path: { workspaceId, noteId } },
      }),
    );
    unwrapEmpty(
      await client.PUT("/v1/workspaces/{workspaceId}/release-notes/{noteId}", {
        params: { path: { workspaceId, noteId } },
        body: {
          title: current.title,
          body,
          ...(kind ? { type: kind as "new" | "improved" | "fixed" } : {}),
        },
      }),
    );
    unwrapEmpty(
      await client.PUT(
        "/v1/workspaces/{workspaceId}/release-notes/{noteId}/requests",
        { params: { path: { workspaceId, noteId } }, body: { requestIds } },
      ),
    );
  });
  if (!res.ok) return res.state;
  refresh(workspaceId, noteId);
  return { notice: "Saved." };
}

/** Renames a note. The title is the page's identity, so it is edited from the note's own menu. */
export async function renameNoteAction(
  workspaceId: string,
  noteId: string,
  title: string,
): Promise<PublishResult> {
  if (!isUuid(workspaceId) || !isUuid(noteId)) return { error: BAD_LINK };
  const clean = title.trim();
  if (!clean) return { error: "The note needs a title." };
  if (clean.length > 200) return { error: "Keep the title under 200 characters." };
  const client = await api();
  const res = await attempt(async () => {
    const current = unwrap(
      await client.GET("/v1/workspaces/{workspaceId}/release-notes/{noteId}", {
        params: { path: { workspaceId, noteId } },
      }),
    );
    unwrapEmpty(
      await client.PUT("/v1/workspaces/{workspaceId}/release-notes/{noteId}", {
        params: { path: { workspaceId, noteId } },
        body: { title: clean, body: current.body, type: current.type },
      }),
    );
  });
  if (!res.ok) return { error: res.state?.error };
  refresh(workspaceId, noteId);
  return { notice: "Renamed." };
}

export async function duplicateNoteAction(
  workspaceId: string,
  noteId: string,
): Promise<PublishResult> {
  if (!isUuid(workspaceId) || !isUuid(noteId)) return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/release-notes/{noteId}/duplicate", {
        params: { path: { workspaceId, noteId } },
      }),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  refresh(workspaceId, res.value.id);
  redirect(`/w/${workspaceId}/releases/${res.value.id}`);
}

/** Deletes a draft. A note that has been public can only be taken down, which the API enforces. */
export async function deleteDraftAction(
  workspaceId: string,
  noteId: string,
): Promise<PublishResult> {
  if (!isUuid(workspaceId) || !isUuid(noteId)) return { error: BAD_LINK };
  const client = await api();
  const res = await attempt(async () =>
    unwrapEmpty(
      await client.DELETE(
        "/v1/workspaces/{workspaceId}/release-notes/{noteId}",
        { params: { path: { workspaceId, noteId } } },
      ),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  refresh(workspaceId);
  return { notice: "Draft deleted." };
}

export type PublishResult = { error?: string; notice?: string };

/** Publishes now, or at the moment the person meant in their own time zone. */
export async function publishNoteAction(
  workspaceId: string,
  noteId: string,
  when: { local?: string; timeZone?: string },
): Promise<PublishResult> {
  if (!isUuid(workspaceId) || !isUuid(noteId)) return { error: BAD_LINK };
  let scheduledFor: string | undefined;
  if (when.local) {
    const instant = localToInstant(when.local, when.timeZone || "UTC");
    if (!instant) return { error: "That date and time is not valid." };
    scheduledFor = instant.toISOString();
  }
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/release-notes/{noteId}/publish", {
        params: { path: { workspaceId, noteId } },
        body: scheduledFor ? { scheduledFor } : {},
      }),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  refresh(workspaceId, noteId);
  return { notice: scheduledFor ? "Scheduled." : "Published." };
}

/** Stops a scheduled note from publishing and puts it back among the drafts (it was never public). */
export async function unscheduleNoteAction(
  workspaceId: string,
  noteId: string,
): Promise<PublishResult> {
  if (!isUuid(workspaceId) || !isUuid(noteId)) return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/release-notes/{noteId}/unschedule", {
        params: { path: { workspaceId, noteId } },
      }),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  refresh(workspaceId, noteId);
  return { notice: "Back in drafts; it will not publish." };
}

export async function unpublishNoteAction(
  workspaceId: string,
  noteId: string,
): Promise<PublishResult> {
  if (!isUuid(workspaceId) || !isUuid(noteId)) return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/release-notes/{noteId}/unpublish", {
        params: { path: { workspaceId, noteId } },
      }),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  refresh(workspaceId, noteId);
  return { notice: "Taken off the public page." };
}
