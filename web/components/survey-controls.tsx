"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  closeSurveyAction,
  deleteSurveyAction,
  openSurveyAction,
  resetLinkAction,
  scheduleSurveyCloseAction,
} from "@/app/(app)/w/[workspaceId]/surveys/actions";
import { ConfirmDelete } from "./confirm-delete";
import { LocalTime } from "./local-time";
import { FormError } from "./form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

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
  closesAt,
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
  closesAt?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const [when, setWhen] = useState("");
  // The input shows the reader's local time, which the server cannot know; fill it after hydration.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setWhen(localInput(closesAt)), [closesAt]);
  const run = (fn: () => Promise<{ error?: string } | undefined>) =>
    start(async () => {
      const r = await fn();
      setError(r?.error);
      if (!r?.error) router.refresh();
    });

  function saveSchedule(e: React.FormEvent) {
    e.preventDefault();
    if (!when) return;
    run(() =>
      scheduleSurveyCloseAction(
        workspaceId,
        surveyId,
        new Date(when).toISOString(),
      ),
    );
  }
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
            <Button
              type="button"
              disabled={pending || !hasQuestions}
              onClick={() => run(() => openSurveyAction(workspaceId, surveyId))}
            >
              {state === "closed" ? "Open it again" : "Open the survey"}
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(() => closeSurveyAction(workspaceId, surveyId))
              }
            >
              Close the survey
            </Button>
          )}
        </div>
      ) : null}
      {state === "draft" && !hasQuestions ? (
        <p className="text-sm text-muted-foreground">
          Add a question before opening.
        </p>
      ) : null}
      <div className="space-y-2 border-t border-border pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm">
            {closesAt ? (
              <>
                Closes automatically on <LocalTime iso={closesAt} time />
              </>
            ) : (
              "No automatic close."
            )}
          </p>
          {closesAt && canWrite ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() =>
                run(() =>
                  scheduleSurveyCloseAction(workspaceId, surveyId, null),
                )
              }
            >
              Clear
            </Button>
          ) : null}
        </div>
        {canWrite && state !== "closed" ? (
          <form
            onSubmit={saveSchedule}
            className="flex flex-wrap items-end gap-2"
          >
            <div>
              <Label
                htmlFor="sv-closes"
                className="mb-1 block text-sm font-medium"
              >
                Close automatically
              </Label>
              <Input
                id="sv-closes"
                type="datetime-local"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
                className="w-auto"
              />
            </div>
            <Button type="submit" variant="outline" disabled={pending || !when}>
              {pending ? "Saving…" : "Save schedule"}
            </Button>
          </form>
        ) : null}
        {state === "closed" ? (
          <p className="text-sm text-muted-foreground">
            Reopen the survey to schedule a close.
          </p>
        ) : null}
      </div>

      {delivery === "open" && publicLink ? (
        <div className="space-y-3">
          <div>
            <Label htmlFor="sv-link" className="mb-1 block text-sm font-medium">
              Public link (anyone who has it can answer, once per browser)
            </Label>
            <Input
              id="sv-link"
              readOnly
              value={publicLink}
              className="font-mono text-sm"
            />
          </div>
          {embedUrl ? (
            <div>
              <Label
                htmlFor="sv-embed"
                className="mb-1 block text-sm font-medium"
              >
                Show it inside a page of your own
              </Label>
              <Textarea
                id="sv-embed"
                readOnly
                rows={3}
                className="font-mono text-xs"
                value={`<script src="${new URL(embedUrl).origin}/embed.js" data-survey="${embedUrl}" async></script>`}
              />
            </div>
          ) : null}
          {canWrite ? (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => run(() => resetLinkAction(workspaceId, surveyId))}
            >
              Make a new link (the old one stops working)
            </Button>
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

/** "2026-11-02T09:00:00Z" -> the local value a datetime-local input expects. */
function localInput(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
