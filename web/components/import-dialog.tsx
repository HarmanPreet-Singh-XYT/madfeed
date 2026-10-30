"use client";

import { useState, type ReactNode } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ImportWizard } from "@/components/import-wizard";

/**
 * Importing is a task, not a permanent part of the directory. It opens over the list, so the page a person
 * returns to after an import is the list they started from.
 */
export function ImportDialog({
  workspaceId,
  trigger,
}: {
  workspaceId: string;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>Import from a spreadsheet</SheetTitle>
          <SheetDescription>
            Columns for name, email, company and revenue are matched
            automatically. We show you what we understood before anything is
            saved.
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-8">
          <ImportWizard workspaceId={workspaceId} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
