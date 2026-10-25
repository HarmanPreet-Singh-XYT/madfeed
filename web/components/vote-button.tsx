"use client";

import { useActionState } from "react";
import { signedVoteAction, voteAction } from "@/app/r/[slug]/roadmap/actions";
import { FormError } from "./form-message";
import { btn, btnPrimary } from "./ui";

export function VoteButton({
  slug,
  requestId,
  title,
  votes,
  verifiedVotes,
  voted,
  token,
}: {
  slug: string;
  requestId: string;
  title: string;
  votes: number;
  verifiedVotes: number;
  voted: boolean;
  /** A voting link signed by the company's own app; when present no account is needed. */
  token?: string;
}) {
  const [state, action, pending] = useActionState(
    token
      ? signedVoteAction.bind(null, slug, requestId, token)
      : voteAction.bind(null, slug, requestId),
    undefined,
  );
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <button
        type="submit"
        name="intent"
        value={voted ? "remove" : "vote"}
        className={voted ? btn : btnPrimary}
        disabled={pending}
        aria-pressed={voted}
      >
        {voted ? "Remove my vote" : "Vote"}
        <span className="sr-only"> for {title}</span>
      </button>
      <span className="text-sm text-muted-foreground">
        {votes} {votes === 1 ? "vote" : "votes"}
        {verifiedVotes > 0 ? ` (${verifiedVotes} from verified customers)` : ""}
      </span>
      <FormError message={state?.error} />
    </form>
  );
}
