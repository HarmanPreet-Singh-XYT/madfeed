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

/** How much of the conversation to show either side of a highlight, in bytes. */
const CONTEXT_BYTES = 320;

export type HighlightContext = { before: string; after: string };

/**
 * The words around a highlight, so it can be read in place instead of
 * navigating away and losing the list you were working through. Spans are byte
 * offsets, so the source text is cut as bytes and decoded back to characters.
 */
export async function highlightContextAction(
  workspaceId: string,
  sourceItemId: string,
  spanStart: number,
  spanEnd: number,
): Promise<{ context?: HighlightContext; error?: string }> {
  if (!ids(workspaceId, sourceItemId)) return { error: BAD_LINK };
  if (
    !Number.isInteger(spanStart) ||
    !Number.isInteger(spanEnd) ||
    spanStart < 0 ||
    spanEnd < spanStart
  )
    return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).GET("/v1/workspaces/{workspaceId}/sources/{sourceItemId}", {
        params: { path: { workspaceId, sourceItemId } },
      }),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  const bytes = new TextEncoder().encode(res.value.text ?? "");
  if (spanStart > bytes.length || spanEnd > bytes.length)
    return { error: BAD_LINK };
  const decoder = new TextDecoder();
  const cutBefore = Math.max(0, spanStart - CONTEXT_BYTES);
  const cutAfter = Math.min(bytes.length, spanEnd + CONTEXT_BYTES);
  let before = decoder.decode(bytes.subarray(cutBefore, spanStart));
  let after = decoder.decode(bytes.subarray(spanEnd, cutAfter));
  // Start and end on whole words: a preview that opens mid-word reads as broken.
  if (cutBefore > 0) {
    const gap = before.search(/\s/);
    if (gap >= 0) before = before.slice(gap + 1);
  }
  if (cutAfter < bytes.length) {
    const gap = after.lastIndexOf(" ");
    if (gap > 0) after = after.slice(0, gap);
  }
  return { context: { before: before.trim(), after: after.trim() } };
}

export type NewTag = { id: string; name: string; color: string };
export type NewTagResult = { error?: string; tag?: NewTag };

/** A tag created from the picker, so tagging does not detour through the codebook. */
export async function createTagInlineAction(
  workspaceId: string,
  name: string,
): Promise<NewTagResult> {
  if (!ids(workspaceId)) return { error: BAD_LINK };
  const clean = name.trim();
  if (!clean) return { error: "Give the tag a name." };
  if (clean.length > 60)
    return { error: "A tag name can be at most 60 characters." };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/tags", {
        params: { path: { workspaceId } },
        body: { name: clean, definition: "", color: "gray" },
      }),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  refresh(workspaceId);
  return { tag: { id: res.value.id, name: clean, color: "gray" } };
}

export async function addTagsToHighlightsAction(
  workspaceId: string,
  highlightIds: string[],
  tagIds: string[],
): Promise<Result> {
  if (!ids(workspaceId, ...highlightIds, ...tagIds))
    return { error: BAD_LINK };
  if (highlightIds.length === 0) return { error: "Choose some highlights." };
  if (tagIds.length === 0) return { error: "Choose a tag." };
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/highlights/tags", {
        params: { path: { workspaceId } },
        body: { highlightIds, tagIds: tagIds.slice(0, 10) },
      }),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  refresh(workspaceId);
  return { notice: `Tagged ${count(highlightIds.length, "highlight")}.` };
}

export async function deleteHighlightsAction(
  workspaceId: string,
  highlightIds: string[],
): Promise<Result> {
  if (!ids(workspaceId, ...highlightIds)) return { error: BAD_LINK };
  if (highlightIds.length === 0) return { error: "Choose some highlights." };
  const client = await api();
  for (const highlightId of highlightIds) {
    const res = await attempt(async () =>
      unwrapEmpty(
        await client.DELETE("/v1/workspaces/{workspaceId}/highlights/{highlightId}", {
          params: { path: { workspaceId, highlightId } },
        }),
      ),
    );
    if (!res.ok) return { error: res.state?.error };
  }
  refresh(workspaceId);
  return { notice: `Removed ${count(highlightIds.length, "highlight")}.` };
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
