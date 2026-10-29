"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { restoreFindingAction } from "@/app/(app)/w/[workspaceId]/findings/actions";
import { Button } from "@/components/ui/button";

export function RestoreFinding({
  workspaceId,
  docId,
  title,
}: {
  workspaceId: string;
  docId: string;
  title: string;
}) {
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await restoreFindingAction(workspaceId, docId);
          if (r?.error) toast.error(r.error);
          else toast.success(`${title} restored`);
        })
      }
    >
      <RotateCcw aria-hidden="true" />
      {pending ? "Restoring…" : "Restore"}
    </Button>
  );
}
