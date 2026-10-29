"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { api, unwrap, unwrapEmpty } from "@/lib/server/api";
import { attempt, type FormState } from "@/lib/server/actions-util";
import { isUuid } from "@/lib/text";

const BAD_LINK = "That link is not valid. Go back and try again.";

export type BlockDraft =
  | { kind: "text"; body: string }
  | { kind: "heading"; body: string }
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

async function persistFinding(
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
            b.kind === "quote"
              ? {
                  kind: "quote" as const,
                  body: b.body,
                  ...(b.id ? { id: b.id } : {}),
                  ...(b.quoteKind && b.quoteId
                    ? { quoteKind: b.quoteKind, quoteId: b.quoteId }
                    : {}),
                }
              : { kind: b.kind, body: b.body },
          ),
        },
      }),
    );
  });
  if (!res.ok) return res.state;
  refresh(workspaceId, docId);
  return undefined;
}

export async function saveFindingAction(
  workspaceId: string,
  docId: string,
  title: string,
  blocks: BlockDraft[],
): Promise<FormState> {
  return persistFinding(workspaceId, docId, title, blocks);
}

/** Debounced save while someone writes. Separate name so a slow save is easy to spot in logs. */
export async function autosaveFindingAction(
  workspaceId: string,
  docId: string,
  title: string,
  blocks: BlockDraft[],
): Promise<FormState> {
  return persistFinding(workspaceId, docId, title, blocks);
}

export async function publishFindingAction(
  workspaceId: string,
  docId: string,
  confirmed: boolean,
  expiresAt?: string,
  password?: string,
): Promise<FormState> {
  if (!isUuid(workspaceId) || !isUuid(docId)) return { error: BAD_LINK };
  let expires: string | undefined;
  if (expiresAt) {
    const at = new Date(expiresAt);
    if (Number.isNaN(at.getTime()) || at.getTime() <= Date.now()) {
      return { error: "Choose a future time for the link to stop working." };
    }
    expires = at.toISOString();
  }
  if (password && password.length < 8) {
    return { error: "Use a password of at least 8 characters." };
  }
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/findings/{docId}/publish", {
        params: { path: { workspaceId, docId } },
        body: {
          confirmed,
          ...(expires ? { expiresAt: expires } : {}),
          ...(password ? { password } : {}),
        },
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

export async function restoreFindingAction(
  workspaceId: string,
  docId: string,
): Promise<FormState> {
  if (!isUuid(workspaceId) || !isUuid(docId)) return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/findings/{docId}/restore", {
        params: { path: { workspaceId, docId } },
      }),
    ),
  );
  if (!res.ok) return res.state;
  refresh(workspaceId);
  return undefined;
}

export async function duplicateFindingAction(
  workspaceId: string,
  docId: string,
): Promise<FormState> {
  if (!isUuid(workspaceId) || !isUuid(docId)) return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/findings/{docId}/duplicate", {
        params: { path: { workspaceId, docId } },
      }),
    ),
  );
  if (!res.ok) return res.state;
  refresh(workspaceId);
  redirect(`/w/${workspaceId}/findings/${res.value.id}`);
}

export type FindingVersion = {
  id: string;
  title: string;
  blocks: number;
  createdAt: string;
};

export async function listFindingVersionsAction(
  workspaceId: string,
  docId: string,
): Promise<{ error?: string; versions?: FindingVersion[] }> {
  if (!isUuid(workspaceId) || !isUuid(docId)) return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).GET("/v1/workspaces/{workspaceId}/findings/{docId}/versions", {
        params: { path: { workspaceId, docId } },
      }),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  return { versions: res.value.versions };
}

export async function restoreFindingVersionAction(
  workspaceId: string,
  docId: string,
  versionId: string,
): Promise<FormState> {
  if (![workspaceId, docId, versionId].every(isUuid))
    return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).POST(
        "/v1/workspaces/{workspaceId}/findings/{docId}/versions/{versionId}/restore",
        { params: { path: { workspaceId, docId, versionId } } },
      ),
    ),
  );
  if (!res.ok) return res.state;
  refresh(workspaceId, docId);
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
