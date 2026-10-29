"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { bulkConversationsAction, type BulkAction } from "@/app/(app)/w/[workspaceId]/inbox/actions";
import { LocalTime } from "./local-time";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";

export type ConversationRow = {
  id: string;
  channel: string;
  state: string;
  subject: string;
  customerName: string;
  customerEmail: string;
  assignee?: string;
  preview: string;
  messages: number;
  lastMessageAt: string;
  assignedToMe: boolean;
  awaitingReply: boolean;
  unread: boolean;
};

const DONE: Record<BulkAction, string> = {
  take: "taken by you",
  release: "back in the queue",
  close: "closed",
  reopen: "reopened",
};

/**
 * The queue. Selecting rows is the point: a batch of conversations from one
 * customer, or everything left overnight, is dealt with in one move.
 */
export function ConversationList({
  workspaceId,
  conversations,
  names,
  canWrite,
}: {
  workspaceId: string;
  conversations: ConversationRow[];
  names: Record<string, string>;
  canWrite: boolean;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const ids = conversations.map((c) => c.id);
  const allChosen = ids.length > 0 && selected.length === ids.length;

  function toggle(id: string, on: boolean) {
    setSelected((v) => (on ? [...v, id] : v.filter((x) => x !== id)));
  }

  function act(action: BulkAction) {
    const chosen = selected;
    start(async () => {
      const r = await bulkConversationsAction(workspaceId, chosen, action);
      if (r.error) {
        toast.error(r.error);
        return;
      }
      toast.success(
        `${r.updated ?? chosen.length} ${r.updated === 1 ? "conversation" : "conversations"} ${DONE[action]}.`,
      );
      setSelected([]);
    });
  }

  return (
    <>
      <Card asChild className="[--card-spacing:0px] overflow-hidden py-0">
        <ul className="divide-y divide-border" aria-label="Conversations">
          {conversations.map((c) => (
            <li key={c.id} className={c.unread ? "bg-tint-blue/30" : undefined}>
              <div className="flex items-start gap-3 px-4 py-3">
                {canWrite ? (
                  <span className="pt-1">
                    <Checkbox
                      checked={selected.includes(c.id)}
                      onCheckedChange={(v) => toggle(c.id, v === true)}
                      aria-label={`Select the conversation with ${c.customerName || c.customerEmail || "a visitor"}`}
                    />
                  </span>
                ) : null}
                <Link
                  href={`/w/${workspaceId}/inbox/${c.id}`}
                  className="flex min-w-0 flex-1 gap-3"
                >
                  <span
                    aria-hidden="true"
                    className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-primary"
                  >
                    {(c.customerName || c.customerEmail || "V")
                      .slice(0, 1)
                      .toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <p
                        className={`truncate ${c.unread ? "font-semibold" : "font-medium"}`}
                      >
                        {c.unread ? (
                          <span
                            aria-hidden="true"
                            className="mr-1.5 inline-block size-2 rounded-full bg-brand-1 align-middle"
                          />
                        ) : null}
                        <span className="sr-only">
                          {c.unread ? "Unread. " : ""}
                        </span>
                        {c.customerName || c.customerEmail || "A visitor"}
                        {c.subject ? (
                          <span className="font-normal text-muted-foreground">
                            {" "}
                            · {c.subject}
                          </span>
                        ) : null}
                      </p>
                      <LocalTime
                        iso={c.lastMessageAt}
                        relative
                        short
                        className="shrink-0 text-xs text-muted-foreground"
                      />
                    </div>
                    <p className="truncate text-sm text-muted-foreground">
                      {c.preview || "No messages yet."}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      {c.state === "closed" ? (
                        <span className="rounded-full bg-muted px-2 py-0.5 font-medium">
                          Closed
                        </span>
                      ) : c.awaitingReply ? (
                        <span className="rounded-full bg-tint-amber px-2 py-0.5 font-medium">
                          Waiting for an answer
                        </span>
                      ) : (
                        <span className="rounded-full bg-tint-blue px-2 py-0.5 font-medium">
                          We answered
                        </span>
                      )}
                      <span className="text-muted-foreground">
                        {c.channel === "chat" ? "Chat" : "Email"} ·{" "}
                        {c.messages} {c.messages === 1 ? "message" : "messages"}
                      </span>
                      <span className="text-muted-foreground">
                        ·{" "}
                        {c.assignee
                          ? c.assignedToMe
                            ? "you have it"
                            : `${names[c.assignee] || "a teammate"} has it`
                          : "nobody has it"}
                      </span>
                    </div>
                  </div>
                </Link>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {selected.length > 0 ? (
        <div
          role="region"
          aria-label="Selected conversations"
          aria-live="polite"
          className="sticky bottom-4 z-20 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-3 shadow-card"
        >
          <span className="text-sm font-medium">
            {selected.length} selected
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setSelected(allChosen ? [] : ids)}
          >
            {allChosen ? "Clear selection" : "Select all on this page"}
          </Button>
          <span className="flex-1" />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => act("take")}
          >
            Take
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => act("close")}
          >
            Close
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => act("reopen")}
          >
            Reopen
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => act("release")}
          >
            Give back
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setSelected([])}
          >
            Done
          </Button>
        </div>
      ) : null}
    </>
  );
}
