"use client";

import { useActionState, useState } from "react";
import { setPublicAction } from "@/app/(app)/w/[workspaceId]/requests/[requestId]/actions";
import { keepForm } from "@/lib/keep-form";
import { FormError } from "./form-message";
import { btn, btnPrimary, card, field } from "./ui";

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
    <form
      method="post"
      onSubmit={keepForm(action)}
      className={`${card} space-y-3`}
    >
      <h2 className="text-lg font-medium">Public roadmap</h2>
      {isPublic ? (
        <p className="text-sm" id="public-state">
          This request is <strong>on the public roadmap</strong>
          {slug ? ` at /r/${slug}/roadmap` : ""}. Visitors see the public title
          and summary below and its status. They never see this request&apos;s
          own title, the customers or their quotes.
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
        <input
          id="public-title"
          name="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          className={field}
        />
      </div>
      <div>
        <label htmlFor="summary" className="mb-1 block text-sm font-medium">
          Summary for the public
        </label>
        <textarea
          id="summary"
          name="summary"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={1000}
          rows={3}
          className={field}
          aria-describedby="summary-help"
        />
        <p id="summary-help" className="mt-1 text-sm text-muted-foreground">
          Written for visitors, not copied from customers. This request&apos;s
          own title is never shown.
        </p>
      </div>
      <FormError message={state?.error} />
      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          name="intent"
          value="publish"
          className={btnPrimary}
          disabled={pending}
        >
          {isPublic ? "Update public summary" : "Show on public roadmap"}
        </button>
        {isPublic ? (
          <button
            type="submit"
            name="intent"
            value="hide"
            className={btn}
            disabled={pending}
          >
            Make private
          </button>
        ) : null}
      </div>
    </form>
  );
}
