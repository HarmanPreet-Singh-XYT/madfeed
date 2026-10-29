"use client";

import { useEffect, useRef } from "react";
import { markConversationReadAction } from "@/app/(app)/w/[workspaceId]/inbox/actions";

/**
 * Opening a conversation means it has been read. Call it once per newest
 * message, so a new arrival while the page is open is marked read too, but the
 * same one is not sent twice.
 */
export function MarkRead({
  workspaceId,
  conversationId,
  lastMessageId,
}: {
  workspaceId: string;
  conversationId: string;
  lastMessageId: string;
}) {
  const sent = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (sent.current === lastMessageId) return;
    sent.current = lastMessageId;
    void markConversationReadAction(workspaceId, conversationId);
  }, [workspaceId, conversationId, lastMessageId]);
  return null;
}
