"use client";

import { useActionState } from "react";
import { setPublicAction } from "@/app/(app)/w/[workspaceId]/requests/[requestId]/actions";
import { FormError } from "./form-message";
import { btn, btnPrimary, card, field } from "./ui";

export function PublicToggle({
  workspaceId,
  requestId,
  title,
  isPublic,
  summary,
  slug,
}: {
  workspaceId: string;
  requestId: string;
  title: string;
  isPublic: boolean;
  summary: string;
  slug?: string;
}) {
  const [state, action, pending] = useActionState(
    setPublicAction.bind(null, workspaceId, requestId),
    undefined,
  );
  return (
    <form action={action} className={`${card} space-y-3`}>
      <h2 className="text-lg font-medium">Public roadmap</h2>
      {isPublic ? (
        <p className="text-sm" id="public-state">
          This request is <strong>on the public roadmap</strong>
          {slug ? ` at /r/${slug}/roadmap` : ""}. Visitors see its title, the
          summary below and its status. They never see the customers or their
          quotes.
        </p>
      ) : (
        <p className="text-sm text-muted" id="public-state">
          Private. Nobody outside your team can see this request.
        </p>
      )}
      <div>
        <label htmlFor="summary" className="mb-1 block text-sm font-medium">
          Summary for the public
        </label>
        <textarea
          id="summary"
          name="summary"
          defaultValue={summary}
          maxLength={1000}
          rows={3}
          className={field}
          aria-describedby="summary-help"
        />
        <p id="summary-help" className="mt-1 text-sm text-muted">
          Written for visitors, not copied from customers. The title “{title}”
          is shown as it is; change it first if it names someone.
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
