"use client";

import { useActionState } from "react";
import { saveSurveyAction } from "@/app/(app)/w/[workspaceId]/surveys/actions";
import { keepForm } from "@/lib/keep-form";
import { FormError } from "./form-message";
import { SubmitButton } from "./submit-button";
import { field } from "./ui";

export function SurveyDetailsForm({
  workspaceId,
  surveyId,
  canEdit,
  isDraft,
  initial,
}: {
  workspaceId: string;
  surveyId: string;
  canEdit: boolean;
  isDraft: boolean;
  initial: {
    title: string;
    intro: string;
    thankYou: string;
    delivery: "invited" | "open";
    onPersonDelete: "remove" | "anonymise";
  };
}) {
  const [state, action] = useActionState(
    saveSurveyAction.bind(null, workspaceId, surveyId),
    undefined,
  );
  return (
    <form method="post" onSubmit={keepForm(action)} className="space-y-4">
      <div>
        <label htmlFor="sv-title" className="mb-1 block text-sm font-medium">
          Title
        </label>
        <input
          id="sv-title"
          name="title"
          defaultValue={initial.title}
          required
          maxLength={200}
          disabled={!canEdit}
          className={field}
        />
      </div>
      <div>
        <label htmlFor="sv-intro" className="mb-1 block text-sm font-medium">
          Introduction (shown above the questions, and in the invitation email)
        </label>
        <textarea
          id="sv-intro"
          name="intro"
          rows={3}
          maxLength={2000}
          defaultValue={initial.intro}
          disabled={!canEdit}
          className={field}
        />
      </div>
      <div>
        <label htmlFor="sv-thanks" className="mb-1 block text-sm font-medium">
          Thank-you message
        </label>
        <input
          id="sv-thanks"
          name="thankYou"
          maxLength={1000}
          defaultValue={initial.thankYou}
          disabled={!canEdit}
          className={field}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="sv-delivery"
            className="mb-1 block text-sm font-medium"
          >
            How people get it
          </label>
          {isDraft && canEdit ? (
            <select
              id="sv-delivery"
              name="delivery"
              defaultValue={initial.delivery}
              className={field}
            >
              <option value="invited">A personal link by email</option>
              <option value="open">One public link anyone can open</option>
            </select>
          ) : (
            <>
              <input type="hidden" name="delivery" value={initial.delivery} />
              <p id="sv-delivery" className="py-2 text-sm">
                {initial.delivery === "open"
                  ? "One public link anyone can open"
                  : "A personal link by email"}{" "}
                <span className="text-muted">
                  (fixed once the survey opens)
                </span>
              </p>
            </>
          )}
        </div>
        <div>
          <label htmlFor="sv-delete" className="mb-1 block text-sm font-medium">
            If a person is deleted, their answers
          </label>
          <select
            id="sv-delete"
            name="onPersonDelete"
            defaultValue={initial.onPersonDelete}
            disabled={!canEdit}
            className={field}
          >
            <option value="remove">are removed</option>
            <option value="anonymise">
              keep ratings and choices without a name (free text is removed)
            </option>
          </select>
        </div>
      </div>
      <FormError message={state?.error} />
      {state?.saved ? (
        <p role="status" className="text-sm text-muted">
          Saved.
        </p>
      ) : null}
      {canEdit ? (
        <SubmitButton pendingLabel="Saving…">Save details</SubmitButton>
      ) : null}
    </form>
  );
}
