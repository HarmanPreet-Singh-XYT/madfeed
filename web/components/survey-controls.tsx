"use client";

import { useState, useTransition } from "react";
import {
  closeSurveyAction,
  deleteSurveyAction,
  openSurveyAction,
  resetLinkAction,
} from "@/app/(app)/w/[workspaceId]/surveys/actions";
import { ConfirmDelete } from "./confirm-delete";
import { FormError } from "./form-message";
import { btn, btnPrimary, field } from "./ui";

export function SurveyControls({
  workspaceId,
  surveyId,
  state,
  delivery,
  canWrite,
  isAdmin,
  hasQuestions,
  publicLink,
  embedUrl,
}: {
  workspaceId: string;
  surveyId: string;
  state: "draft" | "open" | "closed";
  delivery: "invited" | "open";
  canWrite: boolean;
  isAdmin: boolean;
  hasQuestions: boolean;
  publicLink?: string;
  embedUrl?: string;
}) {
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ error?: string } | undefined>) =>
    start(async () => setError((await fn())?.error));
  return (
    <div className="space-y-4">
      <p className="text-sm">
        Status:{" "}
        <strong>
          {{ draft: "Draft", open: "Open", closed: "Closed" }[state]}
        </strong>
        {state === "draft"
          ? ". Nothing is visible to anyone yet."
          : state === "open"
            ? ". Taking answers."
            : ". Not taking answers."}
      </p>
      {canWrite ? (
        <div className="flex flex-wrap gap-3">
          {state !== "open" ? (
            <button
              type="button"
              className={btnPrimary}
              disabled={pending || !hasQuestions}
              onClick={() => run(() => openSurveyAction(workspaceId, surveyId))}
            >
              {state === "closed" ? "Open it again" : "Open the survey"}
            </button>
          ) : (
            <button
              type="button"
              className={btn}
              disabled={pending}
              onClick={() =>
                run(() => closeSurveyAction(workspaceId, surveyId))
              }
            >
              Close the survey
            </button>
          )}
        </div>
      ) : null}
      {state === "draft" && !hasQuestions ? (
        <p className="text-sm text-muted-foreground">
          Add a question before opening.
        </p>
      ) : null}
      {delivery === "open" && publicLink ? (
        <div className="space-y-3">
          <div>
            <label htmlFor="sv-link" className="mb-1 block text-sm font-medium">
              Public link (anyone who has it can answer, once per browser)
            </label>
            <input
              id="sv-link"
              readOnly
              value={publicLink}
              className={`${field} font-mono text-sm`}
            />
          </div>
          {embedUrl ? (
            <div>
              <label
                htmlFor="sv-embed"
                className="mb-1 block text-sm font-medium"
              >
                Show it inside a page of your own
              </label>
              <textarea
                id="sv-embed"
                readOnly
                rows={3}
                className={`${field} font-mono text-xs`}
                value={`<script src="${new URL(embedUrl).origin}/embed.js" data-survey="${embedUrl}" async></script>`}
              />
            </div>
          ) : null}
          {canWrite ? (
            <button
              type="button"
              className={btn}
              disabled={pending}
              onClick={() => run(() => resetLinkAction(workspaceId, surveyId))}
            >
              Make a new link (the old one stops working)
            </button>
          ) : null}
        </div>
      ) : null}
      <FormError message={error} />
      {isAdmin ? (
        <ConfirmDelete
          label="Delete this survey"
          consequences="This deletes the survey with its invitations and every answer. Free-text answers already sent to your review queue stay there as feedback."
          confirmLabel="Yes, delete the survey"
          thenGo={`/w/${workspaceId}/surveys`}
          action={async () =>
            (await deleteSurveyAction(workspaceId, surveyId)) ?? {}
          }
        />
      ) : null}
    </div>
  );
}
