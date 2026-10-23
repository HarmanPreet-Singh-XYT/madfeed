"use server";

import { revalidatePath } from "next/cache";
import { api, unwrap, unwrapEmpty } from "@/lib/server/api";
import { attempt } from "@/lib/server/actions-util";
import type { components } from "@/lib/api/schema.gen";
import { isUuid } from "@/lib/text";

const BAD_LINK = "That link is not valid. Go back and try again.";

export type Result = { error?: string; notice?: string };
export type AnswerResult = {
  error?: string;
  answer?: components["schemas"]["Answer"];
};

function refresh(workspaceId: string) {
  revalidatePath(`/w/${workspaceId}/research`, "layout");
  revalidatePath(`/w/${workspaceId}/requests`, "layout");
  revalidatePath(`/w/${workspaceId}/sources`, "layout");
}

const ids = (...v: string[]) => v.every(isUuid);
const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

export async function createTagAction(
  workspaceId: string,
  _prev: Result | undefined,
  formData: FormData,
): Promise<Result> {
  if (!ids(workspaceId)) return { error: BAD_LINK };
  const name = String(formData.get("name") ?? "").trim();
  const definition = String(formData.get("definition") ?? "").trim();
  const color = String(formData.get("color") ?? "gray") as "gray";
  if (!name) return { error: "Give the tag a name." };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/tags", {
        params: { path: { workspaceId } },
        body: { name, definition, color },
      }),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  refresh(workspaceId);
  return { notice: `Added “${name}”.` };
}

export async function updateTagAction(
  workspaceId: string,
  tagId: string,
  _prev: Result | undefined,
  formData: FormData,
): Promise<Result> {
  if (!ids(workspaceId, tagId)) return { error: BAD_LINK };
  const name = String(formData.get("name") ?? "").trim();
  const definition = String(formData.get("definition") ?? "").trim();
  const color = String(formData.get("color") ?? "gray") as "gray";
  if (!name) return { error: "A tag needs a name." };
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).PUT("/v1/workspaces/{workspaceId}/tags/{tagId}", {
        params: { path: { workspaceId, tagId } },
        body: { name, definition, color },
      }),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  refresh(workspaceId);
  return { notice: "Saved." };
}

export async function archiveTagAction(
  workspaceId: string,
  tagId: string,
  restore: boolean,
): Promise<Result> {
  if (!ids(workspaceId, tagId)) return { error: BAD_LINK };
  const res = await attempt(async () => {
    const client = await api();
    return unwrapEmpty(
      restore
        ? await client.POST(
            "/v1/workspaces/{workspaceId}/tags/{tagId}/restore",
            {
              params: { path: { workspaceId, tagId } },
            },
          )
        : await client.POST(
            "/v1/workspaces/{workspaceId}/tags/{tagId}/archive",
            {
              params: { path: { workspaceId, tagId } },
            },
          ),
    );
  });
  if (!res.ok) return { error: res.state?.error };
  refresh(workspaceId);
  return { notice: restore ? "Restored." : "Archived." };
}

export async function mergeTagAction(
  workspaceId: string,
  tagId: string,
  intoTagId: string,
): Promise<Result> {
  if (!ids(workspaceId, tagId, intoTagId)) return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/tags/{tagId}/merge", {
        params: { path: { workspaceId, tagId } },
        body: { intoTagId },
      }),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  refresh(workspaceId);
  const m = res.value;
  return {
    notice: `Merged. ${count(m.highlights, "highlight")} and ${count(m.requests, "request")} now use the other tag. You can undo this.`,
  };
}

export async function undoMergeAction(
  workspaceId: string,
  mergeId: string,
): Promise<Result> {
  if (!ids(workspaceId, mergeId)) return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/tag-merges/{mergeId}/undo", {
        params: { path: { workspaceId, mergeId } },
      }),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  refresh(workspaceId);
  return { notice: "Undone. The tag is back exactly as it was." };
}

export async function createHighlightAction(
  workspaceId: string,
  sourceItemId: string,
  spanStart: number,
  spanEnd: number,
  quote: string,
  tagIds: string[],
  note: string,
): Promise<Result> {
  if (!ids(workspaceId, sourceItemId, ...tagIds)) return { error: BAD_LINK };
  if (
    !Number.isInteger(spanStart) ||
    !Number.isInteger(spanEnd) ||
    spanStart < 0 ||
    spanEnd <= spanStart
  )
    return { error: "Select some text first." };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/highlights", {
        params: { path: { workspaceId } },
        body: {
          sourceItemId,
          spanStart,
          spanEnd,
          quote,
          note: note.trim(),
          tagIds: tagIds.slice(0, 10),
        },
      }),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  refresh(workspaceId);
  return { notice: "Highlighted." };
}

export async function deleteHighlightAction(
  workspaceId: string,
  highlightId: string,
): Promise<Result> {
  if (!ids(workspaceId, highlightId)) return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).DELETE("/v1/workspaces/{workspaceId}/highlights/{highlightId}", {
        params: { path: { workspaceId, highlightId } },
      }),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  refresh(workspaceId);
  return { notice: "Removed." };
}

export async function setHighlightTagsAction(
  workspaceId: string,
  highlightId: string,
  tagIds: string[],
): Promise<Result> {
  if (!ids(workspaceId, highlightId, ...tagIds)) return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).PUT("/v1/workspaces/{workspaceId}/highlights/{highlightId}/tags", {
        params: { path: { workspaceId, highlightId } },
        body: { tagIds: tagIds.slice(0, 10) },
      }),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  refresh(workspaceId);
  return { notice: "Saved." };
}

export async function setRequestTagsAction(
  workspaceId: string,
  requestId: string,
  tagIds: string[],
): Promise<Result> {
  if (!ids(workspaceId, requestId, ...tagIds)) return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).PUT("/v1/workspaces/{workspaceId}/requests/{requestId}/tags", {
        params: { path: { workspaceId, requestId } },
        body: { tagIds: tagIds.slice(0, 10) },
      }),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  refresh(workspaceId);
  return { notice: "Saved." };
}

export async function askAction(
  workspaceId: string,
  question: string,
): Promise<AnswerResult> {
  if (!ids(workspaceId)) return { error: BAD_LINK };
  const q = question.trim();
  if (!q) return { error: "Type a question first." };
  if (q.length > 500)
    return { error: "Please keep the question under 500 characters." };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/qa", {
        params: { path: { workspaceId } },
        body: { question: q },
      }),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  revalidatePath(`/w/${workspaceId}/ask`);
  return { answer: res.value };
}

export async function rateAction(
  workspaceId: string,
  answerId: string,
  rating: "good" | "wrong",
): Promise<Result> {
  if (!ids(workspaceId, answerId)) return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).PUT("/v1/workspaces/{workspaceId}/qa/{answerId}/rating", {
        params: { path: { workspaceId, answerId } },
        body: { rating },
      }),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  return { notice: "Thanks, noted." };
}
