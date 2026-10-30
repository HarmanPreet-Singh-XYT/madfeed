"use client";

import { useActionState } from "react";
import { rotateVotingSecretAction } from "@/app/(app)/w/[workspaceId]/settings/actions";
import { ConfirmSubmit } from "./confirm-submit";
import { FormError } from "./form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

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
      <p className="text-muted-foreground">
        Set a public address above first; the roadmap is reached through it.
      </p>
    );
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
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
        {hasSecret || state?.secret ? (
          <ConfirmSubmit
            label="Make a new secret"
            confirmLabel="Yes, make a new one"
            consequences="Links your app has already signed stop working straight away. Votes already cast are kept."
            disabled={pending}
          />
        ) : (
          <Button type="submit" disabled={pending}>
            Create a signing secret
          </Button>
        )}
      </form>
      {state?.secret ? (
        <div
          role="status"
          className="space-y-2 rounded-xl border border-border p-3"
        >
          <Label htmlFor="vote-secret" className="block text-sm font-medium">
            Your secret. Copy it now: it is shown only once.
          </Label>
          <Input
            id="vote-secret"
            readOnly
            value={state.secret}
            className="font-mono text-sm"
          />
          <p className="text-sm text-muted-foreground">
            Keep it on your server only (for example as the
            FEEDBACK_VOTING_SECRET setting). Never put it in a web page or app.
          </p>
        </div>
      ) : null}
      <div className="space-y-1">
        <h3 className="font-medium">Make the link on your server</h3>
        <Textarea
          readOnly
          aria-label="Example code for the voting link"
          rows={11}
          className="font-mono text-xs"
          value={snippet(webUrl, slug)}
        />
        <p className="text-sm text-muted-foreground">
          Links last up to 24 hours at most. Only the email address is shared.
        </p>
      </div>
    </div>
  );
}
