"use client";

import Link from "next/link";
import { useState } from "react";
import { MessagesSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export type SwitcherItem = {
  id: string;
  name: string;
  line: string;
  unassigned: boolean;
};

/**
 * On a phone the queue is a tap away instead of a back button and a scroll:
 * the same open conversations the desktop rail shows, in a sheet.
 */
export function ConversationSwitcher({
  workspaceId,
  currentId,
  conversations,
}: {
  workspaceId: string;
  currentId: string;
  conversations: SwitcherItem[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="lg:hidden"
        onClick={() => setOpen(true)}
      >
        <MessagesSquare aria-hidden="true" />
        Open ({conversations.length})
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-80 overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Open conversations</SheetTitle>
            <SheetDescription>Pick one to read it.</SheetDescription>
          </SheetHeader>
          <ul className="space-y-0.5 px-2 pb-4">
            {conversations.map((o) => (
              <li key={o.id}>
                <Link
                  href={`/w/${workspaceId}/inbox/${o.id}`}
                  onClick={() => setOpen(false)}
                  aria-current={o.id === currentId ? "page" : undefined}
                  className={`block rounded-lg px-2.5 py-2 text-sm transition-colors ${
                    o.id === currentId
                      ? "bg-muted font-medium"
                      : "hover:bg-muted/60"
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    {o.unassigned ? (
                      <span
                        aria-hidden="true"
                        className="size-1.5 shrink-0 rounded-full bg-hue-amber"
                      />
                    ) : null}
                    <span className="truncate">{o.name}</span>
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {o.line}
                  </span>
                  {o.unassigned ? (
                    <span className="sr-only">nobody has it</span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
          <div className="border-t border-border p-3">
            <Button asChild variant="ghost" className="w-full justify-start">
              <Link href={`/w/${workspaceId}/inbox`}>All conversations</Link>
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
