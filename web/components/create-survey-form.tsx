"use client";

import { useActionState, useState } from "react";
import { createSurveyAction } from "@/app/(app)/w/[workspaceId]/surveys/actions";
import { FormError } from "./form-message";
import { SubmitButton } from "./submit-button";
import { TEMPLATES } from "@/lib/survey-templates";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function CreateSurveyForm({ workspaceId }: { workspaceId: string }) {
  const [state, action] = useActionState(
    createSurveyAction.bind(null, workspaceId),
    undefined,
  );
  // Radix items cannot carry an empty value, so "no template" is kept apart and
  // posted as an empty string, as the native select did.
  const [template, setTemplate] = useState("__any");
  return (
    <form
      action={action}
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)_auto] lg:items-end"
    >
      <div>
        <Label
          id="survey-template-label"
          htmlFor="survey-template"
          className="mb-1 block text-sm font-medium"
        >
          Start from
        </Label>
        <Select value={template} onValueChange={setTemplate}>
          <SelectTrigger
            id="survey-template"
            className="w-full"
            aria-labelledby="survey-template-label"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__any">An empty survey</SelectItem>
            {TEMPLATES.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="hidden"
          name="template"
          value={template === "__any" ? "" : template}
        />
      </div>
      <div className="min-w-0">
        <Label
          id="survey-title-label"
          htmlFor="survey-title"
          className="mb-1 block text-sm font-medium"
        >
          Title
        </Label>
        <Input
          id="survey-title"
          name="title"
          maxLength={200}
          placeholder="Optional with a template"
        />
      </div>
      <div>
        <Label
          id="survey-delivery-label"
          htmlFor="survey-delivery"
          className="mb-1 block text-sm font-medium"
        >
          How people get it
        </Label>
        <Select name="delivery" defaultValue="invited">
          <SelectTrigger
            id="survey-delivery"
            className="w-full"
            aria-labelledby="survey-delivery-label"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="invited">A personal link by email</SelectItem>
            <SelectItem value="open">
              One public link anyone can open
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="sm:col-span-2 lg:col-span-1">
        <SubmitButton pendingLabel="Creating…">Start a survey</SubmitButton>
      </div>
      <div className="sm:col-span-2 lg:col-span-4">
        <FormError message={state?.error} />
      </div>
    </form>
  );
}
