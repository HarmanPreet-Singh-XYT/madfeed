"use server";

import { revalidatePath } from "next/cache";
import { api, unwrap, unwrapEmpty } from "@/lib/server/api";
import { attempt, type FormState } from "@/lib/server/actions-util";
import { isUuid } from "@/lib/text";

const BAD_LINK = "That link is not valid. Go back and try again.";

type Result = { error?: string; notice?: string };
type Feeling = "positive" | "neutral" | "negative" | "mixed" | "none";
type QuoteKind = "evidence" | "highlight";

function refresh(workspaceId: string) {
  revalidatePath(`/w/${workspaceId}/quotes`);
  revalidatePath(`/w/${workspaceId}/findings`);
}

export async function setSentimentAction(
  workspaceId: string,
  kind: QuoteKind,
  quoteId: string,
  label: Feeling,
): Promise<FormState> {
  if (!isUuid(workspaceId) || !isUuid(quoteId)) return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).PUT("/v1/workspaces/{workspaceId}/quotes/{quoteKind}/{quoteId}/sentiment", {
        params: { path: { workspaceId, quoteKind: kind, quoteId } },
        body: { label },
      }),
    ),
  );
  if (!res.ok) return res.state;
  refresh(workspaceId);
  return undefined;
}

/** One feeling on a whole selection, in one request, so bulk labelling is a single round trip. */
export async function labelQuotesAction(
  workspaceId: string,
  items: { kind: QuoteKind; id: string }[],
  label: Feeling,
): Promise<Result> {
  if (!isUuid(workspaceId) || items.length === 0 || items.length > 100)
    return { error: BAD_LINK };
  if (!items.every((i) => isUuid(i.id))) return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/quotes/sentiment", {
        params: { path: { workspaceId } },
        body: { items: items.map((i) => ({ kind: i.kind, id: i.id })), label },
      }),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  refresh(workspaceId);
  const done = res.value.updated;
  return {
    notice: res.value.failed
      ? `Labelled ${done}; ${res.value.failed} could not be changed.`
      : `Labelled ${done} quote${done === 1 ? "" : "s"}.`,
  };
}

export type QuoteViewInput = {
  name: string;
  kind?: QuoteKind;
  tagId?: string;
  sentiment?: Feeling;
  sourceKind?: "paste" | "recording" | "form" | "api" | "chat" | "survey";
  q?: string;
  meaning?: string;
  days?: 7 | 30 | 90;
  personId?: string;
  accountId?: string;
  sort?: "newest" | "oldest";
};

/** Saves the filters on screen under a name everyone in the workspace can reuse. */
export async function saveQuoteViewAction(
  workspaceId: string,
  input: QuoteViewInput,
): Promise<Result> {
  if (!isUuid(workspaceId)) return { error: BAD_LINK };
  const name = input.name.trim();
  if (!name) return { error: "Give the view a name." };
  if (name.length > 60) return { error: "A view name can be at most 60 characters." };
  if (input.tagId && !isUuid(input.tagId)) return { error: BAD_LINK };
  if (input.personId && !isUuid(input.personId)) return { error: BAD_LINK };
  if (input.accountId && !isUuid(input.accountId)) return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/quotes/views", {
        params: { path: { workspaceId } },
        body: {
          name,
          ...(input.kind ? { kind: input.kind } : {}),
          ...(input.tagId ? { tagId: input.tagId } : {}),
          ...(input.sentiment ? { sentiment: input.sentiment } : {}),
          ...(input.sourceKind ? { sourceKind: input.sourceKind } : {}),
          ...(input.q ? { q: input.q.slice(0, 200) } : {}),
          ...(input.meaning ? { meaning: input.meaning.slice(0, 300) } : {}),
          ...(input.days ? { days: input.days } : {}),
          ...(input.personId ? { personId: input.personId } : {}),
          ...(input.accountId ? { accountId: input.accountId } : {}),
          ...(input.sort ? { sort: input.sort } : {}),
        },
      }),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  refresh(workspaceId);
  return { notice: `Saved “${res.value.name}”.` };
}

export async function deleteQuoteViewAction(
  workspaceId: string,
  viewId: string,
): Promise<Result> {
  if (!isUuid(workspaceId) || !isUuid(viewId)) return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).DELETE("/v1/workspaces/{workspaceId}/quotes/views/{viewId}", {
        params: { path: { workspaceId, viewId } },
      }),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  refresh(workspaceId);
  return { notice: "View removed." };
}

export async function classifyAction(
  workspaceId: string,
): Promise<{ error?: string; message?: string }> {
  if (!isUuid(workspaceId)) return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/sentiment/classify", {
        params: { path: { workspaceId } },
      }),
    ),
  );
  if (!res.ok) return res.state ?? {};
  revalidatePath(`/w/${workspaceId}/quotes/trends`);
  return {
    message:
      res.value.pending === 0
        ? "Every quote already has a label."
        : `Started. The model will label up to 200 of the ${res.value.pending} quotes that have no label; it can take a few minutes.`,
  };
}

export async function renameQuoteViewAction(
  workspaceId: string,
  viewId: string,
  name: string,
): Promise<Result> {
  if (!isUuid(workspaceId) || !isUuid(viewId)) return { error: BAD_LINK };
  const clean = name.trim();
  if (!clean) return { error: "Give the view a name." };
  if (clean.length > 60) return { error: "A view name can be at most 60 characters." };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).PUT("/v1/workspaces/{workspaceId}/quotes/views/{viewId}", {
        params: { path: { workspaceId, viewId } },
        body: { name: clean },
      }),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  refresh(workspaceId);
  return { notice: `Renamed to “${res.value.name}”.` };
}

/** Adds one quote card to a draft findings document without touching the rest of it. */
export async function addQuoteToFindingAction(
  workspaceId: string,
  docId: string,
  kind: QuoteKind,
  id: string,
): Promise<Result> {
  if (!isUuid(workspaceId) || !isUuid(docId) || !isUuid(id)) return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/findings/{docId}/blocks/quote", {
        params: { path: { workspaceId, docId } },
        body: { quoteKind: kind, quoteId: id },
      }),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  revalidatePath(`/w/${workspaceId}/findings`);
  revalidatePath(`/w/${workspaceId}/quotes`);
  return { notice: "Added to the finding." };
}
