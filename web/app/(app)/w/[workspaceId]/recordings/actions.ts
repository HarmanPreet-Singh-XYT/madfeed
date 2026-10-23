"use server";

import { revalidatePath } from "next/cache";
import { api, unwrap, unwrapEmpty } from "@/lib/server/api";
import { attempt } from "@/lib/server/actions-util";
import type { components } from "@/lib/api/schema.gen";
import { isUuid } from "@/lib/text";

const BAD_LINK = "That link is not valid. Go back and try again.";

export type MediaInfo = components["schemas"]["Media"];
export type MediaResult = { error?: string; media?: MediaInfo };
export type Result = { error?: string; notice?: string };

const ids = (...v: string[]) => v.every(isUuid);

function refresh(workspaceId: string) {
  revalidatePath(`/w/${workspaceId}/recordings`);
  revalidatePath(`/w/${workspaceId}/research`);
}

export async function startUploadAction(
  workspaceId: string,
  filename: string,
  mimeType: string,
  sizeBytes: number,
  personId: string,
): Promise<MediaResult> {
  if (!ids(workspaceId) || (personId && !isUuid(personId)))
    return { error: BAD_LINK };
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0)
    return { error: "That file is empty." };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/media", {
        params: { path: { workspaceId } },
        body: {
          filename: filename.slice(0, 200),
          mimeType: mimeType.slice(0, 100),
          sizeBytes,
          ...(personId ? { personId } : {}),
        },
      }),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  refresh(workspaceId);
  return { media: res.value };
}

export async function getMediaAction(
  workspaceId: string,
  mediaId: string,
): Promise<MediaResult> {
  if (!ids(workspaceId, mediaId)) return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).GET("/v1/workspaces/{workspaceId}/media/{mediaId}", {
        params: { path: { workspaceId, mediaId } },
      }),
    ),
  );
  return res.ok ? { media: res.value } : { error: res.state?.error };
}

export async function completeUploadAction(
  workspaceId: string,
  mediaId: string,
): Promise<MediaResult> {
  if (!ids(workspaceId, mediaId)) return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/media/{mediaId}/complete", {
        params: { path: { workspaceId, mediaId } },
      }),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  refresh(workspaceId);
  return { media: res.value };
}

export async function deleteMediaAction(
  workspaceId: string,
  mediaId: string,
): Promise<Result> {
  if (!ids(workspaceId, mediaId)) return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).DELETE("/v1/workspaces/{workspaceId}/media/{mediaId}", {
        params: { path: { workspaceId, mediaId } },
      }),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  refresh(workspaceId);
  return { notice: "Deleted." };
}

export async function deleteSourceAction(
  workspaceId: string,
  sourceItemId: string,
): Promise<Result> {
  if (!ids(workspaceId, sourceItemId)) return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).DELETE("/v1/workspaces/{workspaceId}/sources/{sourceItemId}", {
        params: { path: { workspaceId, sourceItemId } },
      }),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  revalidatePath(`/w/${workspaceId}`, "layout");
  return { notice: "Deleted." };
}

export async function deletePersonAction(
  workspaceId: string,
  personId: string,
): Promise<Result> {
  if (!ids(workspaceId, personId)) return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).DELETE("/v1/workspaces/{workspaceId}/people/{personId}", {
        params: { path: { workspaceId, personId } },
      }),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  revalidatePath(`/w/${workspaceId}`, "layout");
  return { notice: "Deleted." };
}

export async function requestSuggestionsAction(
  workspaceId: string,
  sourceItemId: string,
): Promise<Result> {
  if (!ids(workspaceId, sourceItemId)) return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).POST(
        "/v1/workspaces/{workspaceId}/sources/{sourceItemId}/highlight-suggestions",
        { params: { path: { workspaceId, sourceItemId } } },
      ),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  return { notice: "Looking for passages that fit your tags…" };
}

export async function acceptSuggestionAction(
  workspaceId: string,
  sourceItemId: string,
  suggestionId: string,
  tagIds?: string[],
): Promise<Result> {
  if (!ids(workspaceId, sourceItemId, suggestionId, ...(tagIds ?? [])))
    return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST(
        "/v1/workspaces/{workspaceId}/highlight-suggestions/{suggestionId}/accept",
        {
          params: { path: { workspaceId, suggestionId } },
          body: tagIds ? { tagIds: tagIds.slice(0, 10) } : {},
        },
      ),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  revalidatePath(`/w/${workspaceId}/sources/${sourceItemId}`);
  refresh(workspaceId);
  return { notice: "Highlighted." };
}

export async function dismissSuggestionAction(
  workspaceId: string,
  sourceItemId: string,
  suggestionId: string,
): Promise<Result> {
  if (!ids(workspaceId, sourceItemId, suggestionId)) return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).POST(
        "/v1/workspaces/{workspaceId}/highlight-suggestions/{suggestionId}/dismiss",
        { params: { path: { workspaceId, suggestionId } } },
      ),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  revalidatePath(`/w/${workspaceId}/sources/${sourceItemId}`);
  return { notice: "Dismissed." };
}
