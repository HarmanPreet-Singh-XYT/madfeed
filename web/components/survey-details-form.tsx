"use client";

import { useActionState } from "react";
import { saveSurveyAction } from "@/app/(app)/w/[workspaceId]/surveys/actions";
import { keepForm } from "@/lib/keep-form";
import { FormError } from "./form-message";
import { SubmitButton } from "./submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

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
        <Label
          id="sv-title-label"
          htmlFor="sv-title"
          className="mb-1 block text-sm font-medium"
        >
          Title
        </Label>
        <Input
          id="sv-title"
          name="title"
          defaultValue={initial.title}
          required
          maxLength={200}
          disabled={!canEdit}
        />
      </div>
      <div>
        <Label
          id="sv-intro-label"
          htmlFor="sv-intro"
          className="mb-1 block text-sm font-medium"
        >
          Introduction (shown above the questions, and in the invitation email)
        </Label>
        <Textarea
          id="sv-intro"
          name="intro"
          rows={3}
          maxLength={2000}
          defaultValue={initial.intro}
          disabled={!canEdit}
        />
      </div>
      <div>
        <Label
          id="sv-thanks-label"
          htmlFor="sv-thanks"
          className="mb-1 block text-sm font-medium"
        >
          Thank-you message
        </Label>
        <Input
          id="sv-thanks"
          name="thankYou"
          maxLength={1000}
          defaultValue={initial.thankYou}
          disabled={!canEdit}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label
            id="sv-delivery-label"
            htmlFor="sv-delivery"
            className="mb-1 block text-sm font-medium"
          >
            How people get it
          </Label>
          {isDraft && canEdit ? (
            <Select name="delivery" defaultValue={initial.delivery}>
              <SelectTrigger
                id="sv-delivery"
                className="w-full"
                aria-labelledby="sv-delivery-label"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="invited">
                  A personal link by email
                </SelectItem>
                <SelectItem value="open">
                  One public link anyone can open
                </SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <>
              <Input type="hidden" name="delivery" value={initial.delivery} />
              <p id="sv-delivery" className="py-2 text-sm">
                {initial.delivery === "open"
                  ? "One public link anyone can open"
                  : "A personal link by email"}{" "}
                <span className="text-muted-foreground">
                  (fixed once the survey opens)
                </span>
              </p>
            </>
          )}
        </div>
        <div>
          <Label
            id="sv-delete-label"
            htmlFor="sv-delete"
            className="mb-1 block text-sm font-medium"
          >
            If a person is deleted, their answers
          </Label>
          <Select
            name="onPersonDelete"
            defaultValue={initial.onPersonDelete}
            disabled={!canEdit}
          >
            <SelectTrigger
              id="sv-delete"
              className="w-full"
              aria-labelledby="sv-delete-label"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="remove">are removed</SelectItem>
              <SelectItem value="anonymise">
                keep ratings and choices without a name (free text is removed)
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <FormError message={state?.error} />
      {state?.saved ? (
        <p role="status" className="text-sm text-muted-foreground">
          Saved.
        </p>
      ) : null}
      {canEdit ? (
        <SubmitButton pendingLabel="Saving…">Save details</SubmitButton>
      ) : null}
    </form>
  );
}
