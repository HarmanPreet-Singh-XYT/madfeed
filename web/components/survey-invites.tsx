"use client";

import { useState, useTransition } from "react";
import {
  approveInvitesAction,
  createInvitesAction,
  manualLinksAction,
  remindInvitesAction,
  setExcludedAction,
} from "@/app/(app)/w/[workspaceId]/surveys/actions";
import { FormError } from "./form-message";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Invite = {
  id: string;
  personName: string;
  email: string;
  state: string;
  answered: boolean;
  reminder?: string;
  reminded?: number;
};

const STATE: Record<string, string> = {
  draft: "Waiting for your approval",
  approved: "Approved, sending",
  sending: "Sending",
  sent: "Sent",
  failed: "Could not be sent",
  suppressed: "Asked not to be emailed",
  excluded: "Left off by you",
  manual: "No email address: you hand them their link",
};

export function SurveyInvites({
  workspaceId,
  surveyId,
  surveyState,
  canWrite,
  emailConfigured,
  hasAudience,
  invites,
  remindable,
  wording,
}: {
  workspaceId: string;
  surveyId: string;
  surveyState: "draft" | "open" | "closed";
  canWrite: boolean;
  emailConfigured: boolean;
  hasAudience: boolean;
  invites: Invite[];
  remindable: number;
  wording: { subject: string; text: string };
}) {
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [checked, setChecked] = useState(false);
  const [withoutEmail, setWithoutEmail] = useState(false);
  const [links, setLinks] = useState<{ personName: string; link: string }[]>();
  const [pending, start] = useTransition();
  const waiting = invites.filter((i) => i.state === "draft").length;
  const run = (fn: () => Promise<{ error?: string; message?: string }>) =>
    start(async () => {
      const r = await fn();
      setError(r.error);
      setMessage(r.message);
      setChecked(false);
    });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Nobody is emailed until you approve the list below. People who asked not
        to be emailed are never contacted, and each person is asked once.
      </p>
      {canWrite && surveyState !== "closed" ? (
        <div>
          <Button
            type="button"
            variant="outline"
            disabled={pending || !hasAudience}
            onClick={() =>
              run(() =>
                createInvitesAction(workspaceId, surveyId, withoutEmail),
              )
            }
          >
            Write down who will be asked
          </Button>
          {!hasAudience ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Choose an audience first.
            </p>
          ) : null}
          <Label
            id="invite-without-email-label"
            htmlFor="invite-without-email"
            className="mt-2 flex items-start gap-2 text-sm"
          >
            <Checkbox
              id="invite-without-email"
              className="mt-0.5"
              checked={withoutEmail}
              onCheckedChange={(value) => setWithoutEmail(value === true)}
            />
            Also make personal links for people with no email address, for you
            to hand over yourself
          </Label>
        </div>
      ) : null}
      <FormError message={error} />
      {message ? (
        <p role="status" className="text-sm">
          {message}
        </p>
      ) : null}
      <details className="rounded-xl border border-border p-3">
        <summary className="cursor-pointer text-sm font-medium">
          The email people will get
        </summary>
        <div className="mt-2 space-y-1 text-sm">
          <p>
            <strong>Subject:</strong> {wording.subject}
          </p>
          <pre className="whitespace-pre-wrap font-sans text-muted-foreground">
            {wording.text}
          </pre>
        </div>
      </details>
      {invites.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nobody is on the list yet.
        </p>
      ) : (
        <ul
          className="divide-y divide-border text-sm"
          aria-label="People who will be asked"
        >
          {invites.map((i) => (
            <li
              key={i.id}
              className="flex flex-wrap items-center justify-between gap-3 py-2"
            >
              <span>
                <strong>{i.personName}</strong>{" "}
                <span className="text-muted-foreground">{i.email}</span>
                <span className="block text-muted-foreground">
                  {i.answered ? "Answered" : (STATE[i.state] ?? i.state)}
                  {!i.answered && (i.reminded ?? 0) > 0
                    ? ` · reminded ${i.reminded}×`
                    : ""}
                  {!i.answered && i.reminder === "approved"
                    ? " · reminder on the way"
                    : ""}
                </span>
              </span>
              {canWrite && (i.state === "draft" || i.state === "excluded") ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    run(async () => {
                      const r = await setExcludedAction(
                        workspaceId,
                        surveyId,
                        i.id,
                        i.state === "draft",
                      );
                      return r ?? {};
                    })
                  }
                >
                  {i.state === "draft" ? "Leave off" : "Put back"}
                  <span className="sr-only"> {i.personName}</span>
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canWrite && waiting > 0 ? (
        <div className="space-y-3 rounded-xl border border-border p-3">
          {!emailConfigured ? (
            <p className="text-sm">
              Email is not set up on this server yet, so invitations would wait
              until it is.
            </p>
          ) : null}
          {surveyState !== "open" ? (
            <p className="text-sm">
              Open the survey first. Invitations only go out for an open survey.
            </p>
          ) : null}
          <Label
            id="invite-checked-label"
            htmlFor="invite-checked"
            className="flex items-start gap-2 text-sm"
          >
            <Checkbox
              id="invite-checked"
              className="mt-0.5"
              checked={checked}
              onCheckedChange={(value) => setChecked(value === true)}
            />
            I have checked the list and the wording of the email.
          </Label>
          <Button
            type="button"
            disabled={pending || !checked || surveyState !== "open"}
            onClick={() =>
              run(() => approveInvitesAction(workspaceId, surveyId))
            }
          >
            {pending
              ? "Sending…"
              : `Approve and send ${waiting} ${waiting === 1 ? "invitation" : "invitations"}`}
          </Button>
        </div>
      ) : null}
      {canWrite && surveyState === "open" && remindable > 0 ? (
        <div className="space-y-2 rounded-xl border border-border p-3">
          <p className="text-sm">
            {remindable} {remindable === 1 ? "person has" : "people have"} not
            answered yet. You can send each of them a reminder: at most two
            each, at least three days apart.
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() =>
              run(() => remindInvitesAction(workspaceId, surveyId))
            }
          >
            Send a reminder to {remindable}{" "}
            {remindable === 1 ? "person" : "people"}
          </Button>
        </div>
      ) : null}
      {canWrite &&
      surveyState === "open" &&
      invites.some((i) => i.state === "manual") ? (
        <div className="space-y-2 rounded-xl border border-border p-3">
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await manualLinksAction(workspaceId, surveyId);
                setError(r.error);
                setLinks(r.links);
              })
            }
          >
            Show the links to hand over
          </Button>
          {links ? (
            <>
              <p className="text-sm text-muted-foreground">
                Each link is for one person and takes one answer. Anyone who has
                it can answer for them, so give it only to that person.
              </p>
              <Label
                id="manual-links-label"
                htmlFor="manual-links"
                className="sr-only"
              >
                Personal links, one per line
              </Label>
              <Textarea
                id="manual-links"
                readOnly
                rows={Math.min(links.length + 1, 10)}
                className="font-mono text-xs"
                value={links
                  .map((l) => `${l.personName}: ${l.link}`)
                  .join("\n")}
              />
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
