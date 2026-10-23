"use client";

import { useActionState } from "react";
import { rotateVotingSecretAction } from "@/app/(app)/w/[workspaceId]/settings/actions";
import { FormError } from "./form-message";
import { btn, btnPrimary, field } from "./ui";

function snippet(webUrl: string, slug: string) {
  return `// Run this on your own server, for the user who is signed in to your app.
import { createHmac } from "node:crypto";

function roadmapLink(email) {
  const payload = Buffer.from(
    JSON.stringify({ e: email, x: Math.floor(Date.now() / 1000) + 3600 }), // good for one hour
  ).toString("base64url");
  const signature = createHmac("sha256", process.env.FEEDBACK_VOTING_SECRET)
    .update("vote-v1." + payload)
    .digest("base64url");
  return \`${webUrl}/r/${slug}/roadmap?vt=v1.\${payload}.\${signature}\`;
}`;
}

export function VotingSettings({
  workspaceId,
  hasSecret,
  slug,
  webUrl,
}: {
  workspaceId: string;
  hasSecret: boolean;
  slug?: string;
  webUrl: string;
}) {
  const [state, action, pending] = useActionState(
    rotateVotingSecretAction.bind(null, workspaceId),
    undefined,
  );
  if (!slug)
    return (
      <p className="text-muted">
        Set a public address above first; the roadmap is reached through it.
      </p>
    );
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Votes are marked <strong>verified</strong> when the voter&apos;s
        confirmed email matches someone in your People list. You can also vouch
        for your own users: your server makes a link with a secret key, and
        anyone who opens it can vote without creating an account.
      </p>
      <form action={action} className="space-y-3">
        <p className="text-sm">
          {hasSecret || state?.secret
            ? "A signing secret exists."
            : "No signing secret yet, so links from your app can't be used."}
        </p>
        <FormError message={state?.error} />
        <button
          type="submit"
          className={hasSecret || state?.secret ? btn : btnPrimary}
          disabled={pending}
        >
          {hasSecret || state?.secret
            ? "Make a new secret (old links stop working)"
            : "Create a signing secret"}
        </button>
      </form>
      {state?.secret ? (
        <div
          role="status"
          className="space-y-2 rounded-md border border-border p-3"
        >
          <label htmlFor="vote-secret" className="block text-sm font-medium">
            Your secret. Copy it now: it is shown only once.
          </label>
          <input
            id="vote-secret"
            readOnly
            value={state.secret}
            className={`${field} font-mono text-sm`}
          />
          <p className="text-sm text-muted">
            Keep it on your server only (for example as the
            FEEDBACK_VOTING_SECRET setting). Never put it in a web page or app.
          </p>
        </div>
      ) : null}
      <div className="space-y-1">
        <h3 className="font-medium">Make the link on your server</h3>
        <textarea
          readOnly
          aria-label="Example code for the voting link"
          rows={11}
          className={`${field} font-mono text-xs`}
          value={snippet(webUrl, slug)}
        />
        <p className="text-sm text-muted">
          Links last up to 24 hours at most. Only the email address is shared.
        </p>
      </div>
    </div>
  );
}
