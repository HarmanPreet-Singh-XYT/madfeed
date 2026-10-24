"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { api, unwrap, unwrapEmpty } from "@/lib/server/api";
import { attempt, type FormState } from "@/lib/server/actions-util";
import { isUuid } from "@/lib/text";

const BAD_LINK = "That link is not valid. Go back and try again.";

export type BlockDraft =
  | { kind: "text"; body: string }
  | {
      kind: "quote";
      body: string; // the note under the card
      id?: string; // an existing card
      quoteKind?: "evidence" | "highlight";
      quoteId?: string;
    };

function refresh(ws: string, doc?: string) {
  revalidatePath(`/w/${ws}/findings`);
  if (doc) revalidatePath(`/w/${ws}/findings/${doc}`);
}

export async function createFindingAction(
  workspaceId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!isUuid(workspaceId)) return { error: BAD_LINK };
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { error: "Give the document a title." };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/findings", {
        params: { path: { workspaceId } },
        body: { title },
      }),
    ),
  );
  if (!res.ok) return res.state;
  refresh(workspaceId);
  redirect(`/w/${workspaceId}/findings/${res.value.id}`);
}

export async function saveFindingAction(
  workspaceId: string,
  docId: string,
  title: string,
  blocks: BlockDraft[],
): Promise<FormState> {
  if (!isUuid(workspaceId) || !isUuid(docId)) return { error: BAD_LINK };
  const client = await api();
  const res = await attempt(async () => {
    unwrapEmpty(
      await client.PUT("/v1/workspaces/{workspaceId}/findings/{docId}", {
        params: { path: { workspaceId, docId } },
        body: { title },
      }),
    );
    unwrapEmpty(
      await client.PUT("/v1/workspaces/{workspaceId}/findings/{docId}/blocks", {
        params: { path: { workspaceId, docId } },
        body: {
          blocks: blocks.map((b) =>
            b.kind === "text"
              ? { kind: "text" as const, body: b.body }
              : {
                  kind: "quote" as const,
                  body: b.body,
                  ...(b.id ? { id: b.id } : {}),
                  ...(b.quoteKind && b.quoteId
                    ? { quoteKind: b.quoteKind, quoteId: b.quoteId }
                    : {}),
                },
          ),
        },
      }),
    );
  });
  if (!res.ok) return res.state;
  refresh(workspaceId, docId);
  return undefined;
}

export async function publishFindingAction(
  workspaceId: string,
  docId: string,
  confirmed: boolean,
): Promise<FormState> {
  if (!isUuid(workspaceId) || !isUuid(docId)) return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/findings/{docId}/publish", {
        params: { path: { workspaceId, docId } },
        body: { confirmed },
      }),
    ),
  );
  if (!res.ok) return res.state;
  refresh(workspaceId, docId);
  return undefined;
}

export async function unpublishFindingAction(
  workspaceId: string,
  docId: string,
): Promise<FormState> {
  if (!isUuid(workspaceId) || !isUuid(docId)) return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/findings/{docId}/unpublish", {
        params: { path: { workspaceId, docId } },
      }),
    ),
  );
  if (!res.ok) return res.state;
  refresh(workspaceId, docId);
  return undefined;
}

export async function deleteFindingAction(
  workspaceId: string,
  docId: string,
): Promise<FormState> {
  if (!isUuid(workspaceId) || !isUuid(docId)) return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).DELETE("/v1/workspaces/{workspaceId}/findings/{docId}", {
        params: { path: { workspaceId, docId } },
      }),
    ),
  );
  if (!res.ok) return res.state;
  refresh(workspaceId);
  return undefined;
}

export type FoundQuote = {
  kind: "evidence" | "highlight";
  id: string;
  text: string;
  sourceTitle: string;
};

/** Finds stored quotes to put on a card. */
export async function findQuotesAction(
  workspaceId: string,
  search: string,
): Promise<{ error?: string; quotes?: FoundQuote[] }> {
  if (!isUuid(workspaceId)) return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).GET("/v1/workspaces/{workspaceId}/quotes", {
        params: {
          path: { workspaceId },
          query: { q: search.slice(0, 200) || undefined, limit: 20 },
        },
      }),
    ),
  );
  if (!res.ok) return res.state ?? {};
  return {
    quotes: res.value.quotes.map((q) => ({
      kind: q.kind,
      id: q.id,
      text: q.text,
      sourceTitle: q.sourceTitle,
    })),
  };
}
