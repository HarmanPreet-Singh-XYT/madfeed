"use client";

import { Plus } from "lucide-react";
import { SaveViewForm } from "@/components/save-view-form";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * The way to add a saved view, always in reach at the end of the view tabs.
 * A view must stand for some narrowing, so when the list is plain it says what
 * to do first instead of offering a form that would be refused.
 */
export function NewViewButton({
  workspaceId,
  status,
  tag,
  q,
  sort,
  customised,
}: {
  workspaceId: string;
  status: string;
  tag: string;
  q: string;
  sort: string;
  customised: boolean;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-1 text-muted-foreground hover:text-foreground"
        >
          <Plus aria-hidden="true" />
          New view
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        {customised ? (
          <SaveViewForm
            workspaceId={workspaceId}
            status={status}
            tag={tag}
            q={q}
            sort={sort}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            Choose a status or a tag, search titles, or change the order first.
            Then name the view and it appears here for everyone.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
