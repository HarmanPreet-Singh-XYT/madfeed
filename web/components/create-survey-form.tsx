"use client";

import { useActionState } from "react";
import { createSurveyAction } from "@/app/(app)/w/[workspaceId]/surveys/actions";
import { FormError } from "./form-message";
import { SubmitButton } from "./submit-button";
import { TEMPLATES } from "@/lib/survey-templates";
import { field } from "./ui";

export function CreateSurveyForm({ workspaceId }: { workspaceId: string }) {
  const [state, action] = useActionState(
    createSurveyAction.bind(null, workspaceId),
    undefined,
  );
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div>
        <label
          htmlFor="survey-template"
          className="mb-1 block text-sm font-medium"
        >
          Start from
        </label>
        <select id="survey-template" name="template" className={field}>
          <option value="">An empty survey</option>
          {TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div className="min-w-60 flex-1">
        <label
          htmlFor="survey-title"
          className="mb-1 block text-sm font-medium"
        >
          Title
        </label>
        <input
          id="survey-title"
          name="title"
          maxLength={200}
          className={field}
          placeholder="Optional with a template"
        />
      </div>
      <div>
        <label
          htmlFor="survey-delivery"
          className="mb-1 block text-sm font-medium"
        >
          How people get it
        </label>
        <select id="survey-delivery" name="delivery" className={field}>
          <option value="invited">A personal link by email</option>
          <option value="open">One public link anyone can open</option>
        </select>
      </div>
      <SubmitButton pendingLabel="Creating…">Start a survey</SubmitButton>
      <div className="basis-full">
        <FormError message={state?.error} />
      </div>
    </form>
  );
}
