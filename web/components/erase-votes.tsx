"use client";

import { useActionState } from "react";
import { eraseMyVotesAction } from "@/app/r/[slug]/roadmap/actions";
import { FormError } from "./form-message";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export function EraseVotes({ slug }: { slug: string }) {
  const [state, action, pending] = useActionState(
    eraseMyVotesAction.bind(null, slug),
    undefined,
  );
  return (
    <form action={action} className="space-y-2 border-t border-border pt-4">
      <p className="text-sm text-muted-foreground">
        Your votes are tied to your account. You can remove all of them at once.
      </p>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button type="button" variant="outline" disabled={pending}>
            {pending ? "Removing…" : "Remove all my votes"}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove all my votes</AlertDialogTitle>
            <AlertDialogDescription>
              Remove every vote you have cast, on every roadmap? This can&apos;t
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={() => action()}
            >
              Remove all my votes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {state?.removed !== undefined ? (
        <p role="status" className="text-sm">
          {state.removed === 0
            ? "You had no votes to remove."
            : `Removed ${state.removed} ${state.removed === 1 ? "vote" : "votes"}.`}
        </p>
      ) : null}
      <FormError message={state?.error} />
    </form>
  );
}
