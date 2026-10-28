"use client";

import { useActionState, useState } from "react";
import { setPublicAction } from "@/app/(app)/w/[workspaceId]/requests/[requestId]/actions";
import { keepForm } from "@/lib/keep-form";
import { FormError } from "./form-message";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

export function PublicToggle({
  workspaceId,
  requestId,
  isPublic,
  publicTitle,
  summary,
  slug,
}: {
  workspaceId: string;
  requestId: string;
  isPublic: boolean;
  publicTitle: string;
  summary: string;
  slug?: string;
}) {
  const [state, action, pending] = useActionState(
    setPublicAction.bind(null, workspaceId, requestId),
    undefined,
  );
  const [title, setTitle] = useState(publicTitle);
  const [text, setText] = useState(summary);
  return (
    <Card asChild className="[--card-spacing:0px] space-y-3 p-5">
      <form method="post" onSubmit={keepForm(action)}>
        <h2 className="text-lg font-medium">Public roadmap</h2>
        {isPublic ? (
          <p className="text-sm" id="public-state">
            This request is <strong>on the public roadmap</strong>
            {slug ? ` at /r/${slug}/roadmap` : ""}. Visitors see the public
            title and summary below and its status. They never see this
            request&apos;s own title, the customers or their quotes.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground" id="public-state">
            Private. Nobody outside your team can see this request.
          </p>
        )}
        <div>
          <label
            htmlFor="public-title"
            className="mb-1 block text-sm font-medium"
          >
            Title for the public
          </label>
          <Input
            id="public-title"
            name="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
          />
        </div>
        <div>
          <label htmlFor="summary" className="mb-1 block text-sm font-medium">
            Summary for the public
          </label>
          <Textarea
            id="summary"
            name="summary"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={1000}
            rows={3}
            aria-describedby="summary-help"
          />
          <p id="summary-help" className="mt-1 text-sm text-muted-foreground">
            Written for visitors, not copied from customers. This request&apos;s
            own title is never shown.
          </p>
        </div>
        <FormError message={state?.error} />
        <div className="flex flex-wrap gap-3">
          <Button
            type="submit"
            name="intent"
            value="publish"
            disabled={pending}
          >
            {isPublic ? "Update public summary" : "Show on public roadmap"}
          </Button>
          {isPublic ? (
            <Button
              type="submit"
              name="intent"
              value="hide"
              variant="outline"
              disabled={pending}
            >
              Make private
            </Button>
          ) : null}
        </div>
      </form>
    </Card>
  );
}
