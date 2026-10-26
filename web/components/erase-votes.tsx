"use client";

import { useActionState } from "react";
import { eraseMyVotesAction } from "@/app/r/[slug]/roadmap/actions";
import { FormError } from "./form-message";
import { btn } from "./ui";

export function EraseVotes({ slug }: { slug: string }) {
  const [state, action, pending] = useActionState(
    eraseMyVotesAction.bind(null, slug),
    undefined,
  );
  return (
    <form
      action={action}
      className="space-y-2 border-t border-border pt-4"
      onSubmit={(e) => {
        if (
          !window.confirm(
            "Remove every vote you have cast, on every roadmap? This can't be undone.",
          )
        )
          e.preventDefault();
      }}
    >
      <p className="text-sm text-muted-foreground">
        Your votes are tied to your account. You can remove all of them at once.
      </p>
      <button type="submit" className={btn} disabled={pending}>
        {pending ? "Removing…" : "Remove all my votes"}
      </button>
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
