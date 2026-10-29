"use server";

import { revalidatePath } from "next/cache";
import { api, unwrap, unwrapEmpty } from "@/lib/server/api";
import { attempt, type FormState } from "@/lib/server/actions-util";
import { isUuid } from "@/lib/text";

const BAD_LINK = "That link is not valid. Go back and try again.";

function refresh(ws: string, id?: string) {
  revalidatePath(`/w/${ws}/inbox`);
  if (id) revalidatePath(`/w/${ws}/inbox/${id}`);
}

export async function replyAction(
  workspaceId: string,
  conversationId: string,
  seenMessageId: string,
  body: string,
  attachmentIds: string[] = [],
): Promise<
  { error?: string; stale?: boolean; messageId?: string } | undefined
> {
  if (!isUuid(workspaceId) || !isUuid(conversationId) || !isUuid(seenMessageId))
    return { error: BAD_LINK };
  const client = await api();
  const res = await client.POST(
    "/v1/workspaces/{workspaceId}/conversations/{conversationId}/reply",
    {
      params: { path: { workspaceId, conversationId } },
      body: {
        body,
        seenMessageId,
        ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
      },
    },
  );
  if (res.response.status === 409) {
    refresh(workspaceId, conversationId);
    return {
      stale: true,
      error:
        "This conversation changed while you were writing. Read the new messages above, then send again.",
    };
  }
  if (!res.response.ok) {
    const out = await attempt(async () => unwrap(res));
    return out.ok ? undefined : out.state;
  }
  refresh(workspaceId, conversationId);
  return { messageId: res.data?.messageId };
}

async function simple(
  workspaceId: string,
  conversationId: string,
  run: () => Promise<{ error?: unknown; response: Response }>,
): Promise<FormState> {
  if (!isUuid(workspaceId) || !isUuid(conversationId))
    return { error: BAD_LINK };
  const res = await attempt(async () => unwrapEmpty(await run()));
  if (!res.ok) return res.state;
  refresh(workspaceId, conversationId);
  return undefined;
}

export async function noteAction(
  workspaceId: string,
  conversationId: string,
  body: string,
): Promise<{ error?: string; messageId?: string } | undefined> {
  if (!isUuid(workspaceId) || !isUuid(conversationId))
    return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST(
        "/v1/workspaces/{workspaceId}/conversations/{conversationId}/notes",
        {
          params: { path: { workspaceId, conversationId } },
          body: { body },
        },
      ),
    ),
  );
  if (!res.ok) return res.state;
  refresh(workspaceId, conversationId);
  return { messageId: res.value.messageId };
}

export async function assignAction(
  workspaceId: string,
  conversationId: string,
  take: boolean,
  expectedAssignee?: string,
  assignTo?: string,
): Promise<{ error?: string; stale?: boolean } | undefined> {
  if (!isUuid(workspaceId) || !isUuid(conversationId))
    return { error: BAD_LINK };
  if (assignTo !== undefined && !isUuid(assignTo)) return { error: BAD_LINK };
  const res = await (
    await api()
  ).PUT(
    "/v1/workspaces/{workspaceId}/conversations/{conversationId}/assignee",
    {
      params: { path: { workspaceId, conversationId } },
      body: {
        take,
        ...(expectedAssignee ? { expectedAssignee } : {}),
        ...(assignTo ? { assignTo } : {}),
      },
    },
  );
  if (res.response.status === 409) {
    refresh(workspaceId, conversationId);
    return {
      stale: true,
      error:
        "Someone else changed who has this conversation. It is shown as it is now.",
    };
  }
  const out = await attempt(async () => unwrapEmpty(res));
  if (!out.ok) return out.state;
  refresh(workspaceId, conversationId);
  return undefined;
}

export async function stateAction(
  workspaceId: string,
  conversationId: string,
  state: "open" | "closed",
) {
  return simple(workspaceId, conversationId, async () =>
    (await api()).PUT(
      "/v1/workspaces/{workspaceId}/conversations/{conversationId}/state",
      {
        params: { path: { workspaceId, conversationId } },
        body: { state },
      },
    ),
  );
}

export type BulkAction = "take" | "release" | "close" | "reopen";

/** One statement covers the whole batch, so a selection is never half applied. */
export async function bulkConversationsAction(
  workspaceId: string,
  conversationIds: string[],
  action: BulkAction,
): Promise<{ error?: string; updated?: number }> {
  if (!isUuid(workspaceId) || !conversationIds.every(isUuid))
    return { error: BAD_LINK };
  if (conversationIds.length === 0) return { error: "Choose some conversations." };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/conversations/bulk", {
        params: { path: { workspaceId } },
        body: { conversationIds, action },
      }),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  refresh(workspaceId);
  return { updated: res.value.updated };
}

/** Called when a conversation is opened: what you are looking at is read. */
export async function markConversationReadAction(
  workspaceId: string,
  conversationId: string,
): Promise<{ error?: string }> {
  if (!isUuid(workspaceId) || !isUuid(conversationId))
    return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/conversations/{conversationId}/read", {
        params: { path: { workspaceId, conversationId } },
      }),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  // Only the list and the navigation count change; the page you are reading
  // does not need to reload under you.
  revalidatePath(`/w/${workspaceId}/inbox`);
  revalidatePath(`/w/${workspaceId}`, "layout");
  return {};
}

export async function convertAction(
  workspaceId: string,
  conversationId: string,
  messageId: string,
) {
  if (!isUuid(workspaceId) || !isUuid(conversationId) || !isUuid(messageId))
    return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST(
        "/v1/workspaces/{workspaceId}/conversations/{conversationId}/messages/{messageId}/convert",
        {
          params: { path: { workspaceId, conversationId, messageId } },
        },
      ),
    ),
  );
  if (!res.ok) return res.state ?? {};
  refresh(workspaceId, conversationId);
  return undefined;
}

export async function retryAction(
  workspaceId: string,
  conversationId: string,
  messageId: string,
) {
  if (!isUuid(messageId)) return { error: BAD_LINK };
  return simple(workspaceId, conversationId, async () =>
    (await api()).POST(
      "/v1/workspaces/{workspaceId}/conversations/{conversationId}/messages/{messageId}/retry",
      {
        params: { path: { workspaceId, conversationId, messageId } },
      },
    ),
  );
}

export async function deleteConversationAction(
  workspaceId: string,
  conversationId: string,
) {
  return simple(workspaceId, conversationId, async () =>
    (await api()).DELETE(
      "/v1/workspaces/{workspaceId}/conversations/{conversationId}",
      {
        params: { path: { workspaceId, conversationId } },
      },
    ),
  );
}

export type InboxSettingsDraft = {
  chatEnabled: boolean;
  emailEnabled: boolean;
  origins: string[];
  greeting: string;
  rotateWidget?: boolean;
  rotateInbound?: boolean;
};

export async function saveInboxSettingsAction(
  workspaceId: string,
  s: InboxSettingsDraft,
): Promise<FormState> {
  if (!isUuid(workspaceId)) return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).PUT("/v1/workspaces/{workspaceId}/inbox/settings", {
        params: { path: { workspaceId } },
        body: s,
      }),
    ),
  );
  if (!res.ok) return res.state;
  revalidatePath(`/w/${workspaceId}/settings`);
  return undefined;
}

export async function setMyNameAction(
  workspaceId: string,
  name: string,
): Promise<FormState> {
  if (!isUuid(workspaceId)) return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).PUT("/v1/workspaces/{workspaceId}/members/me", {
        params: { path: { workspaceId } },
        body: { name },
      }),
    ),
  );
  if (!res.ok) return res.state;
  revalidatePath(`/w/${workspaceId}/inbox`, "layout");
  return undefined;
}

export async function saveCannedAction(
  workspaceId: string,
  id: string | undefined,
  name: string,
  body: string,
): Promise<FormState> {
  if (!isUuid(workspaceId) || (id !== undefined && !isUuid(id)))
    return { error: BAD_LINK };
  const client = await api();
  const res = await attempt(async () =>
    id
      ? unwrapEmpty(
          await client.PUT(
            "/v1/workspaces/{workspaceId}/inbox/canned-replies/{cannedReplyId}",
            {
              params: { path: { workspaceId, cannedReplyId: id } },
              body: { name, body },
            },
          ),
        )
      : unwrap(
          await client.POST(
            "/v1/workspaces/{workspaceId}/inbox/canned-replies",
            { params: { path: { workspaceId } }, body: { name, body } },
          ),
        ),
  );
  if (!res.ok) return res.state;
  revalidatePath(`/w/${workspaceId}/inbox`, "layout");
  return undefined;
}

export async function deleteCannedAction(
  workspaceId: string,
  id: string,
): Promise<FormState> {
  if (!isUuid(workspaceId) || !isUuid(id)) return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).DELETE(
        "/v1/workspaces/{workspaceId}/inbox/canned-replies/{cannedReplyId}",
        { params: { path: { workspaceId, cannedReplyId: id } } },
      ),
    ),
  );
  if (!res.ok) return res.state;
  revalidatePath(`/w/${workspaceId}/inbox`, "layout");
  return undefined;
}

export async function setReplyTargetAction(
  workspaceId: string,
  hours: number,
): Promise<FormState> {
  if (!isUuid(workspaceId)) return { error: BAD_LINK };
  if (!Number.isInteger(hours) || hours < 0 || hours > 720)
    return { error: "Enter a whole number of hours from 0 to 720." };
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).PUT("/v1/workspaces/{workspaceId}/inbox/reply-target", {
        params: { path: { workspaceId } },
        body: { hours },
      }),
    ),
  );
  if (!res.ok) return res.state;
  revalidatePath(`/w/${workspaceId}/inbox`, "layout");
  return undefined;
}

export type SentFile = { id: string; name: string; size: number };
