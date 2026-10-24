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
import { btn, btnPrimary } from "./ui";

type Invite = {
  id: string;
  personName: string;
  email: string;
  state: string;
  answered: boolean;
  reminder?: string;
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
      <p className="text-sm text-muted">
        Nobody is emailed until you approve the list below. People who asked not
        to be emailed are never contacted, and each person is asked once.
      </p>
      {canWrite && surveyState !== "closed" ? (
        <div>
          <button
            type="button"
            className={btn}
            disabled={pending || !hasAudience}
            onClick={() =>
              run(() =>
                createInvitesAction(workspaceId, surveyId, withoutEmail),
              )
            }
          >
            Write down who will be asked
          </button>
          {!hasAudience ? (
            <p className="mt-1 text-sm text-muted">Choose an audience first.</p>
          ) : null}
          <label className="mt-2 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-5"
              checked={withoutEmail}
              onChange={(e) => setWithoutEmail(e.target.checked)}
            />
            Also make personal links for people with no email address, for you
            to hand over yourself
          </label>
        </div>
      ) : null}
      <FormError message={error} />
      {message ? (
        <p role="status" className="text-sm">
          {message}
        </p>
      ) : null}
      <details className="rounded-md border border-border p-3">
        <summary className="cursor-pointer text-sm font-medium">
          The email people will get
        </summary>
        <div className="mt-2 space-y-1 text-sm">
          <p>
            <strong>Subject:</strong> {wording.subject}
          </p>
          <pre className="whitespace-pre-wrap font-sans text-muted">
            {wording.text}
          </pre>
        </div>
      </details>
      {invites.length === 0 ? (
        <p className="text-sm text-muted">Nobody is on the list yet.</p>
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
                <span className="text-muted">{i.email}</span>
                <span className="block text-muted">
                  {i.answered ? "Answered" : (STATE[i.state] ?? i.state)}
                  {!i.answered && i.reminder === "sent" ? " · reminded" : ""}
                  {!i.answered && i.reminder === "approved"
                    ? " · reminder on the way"
                    : ""}
                </span>
              </span>
              {canWrite && (i.state === "draft" || i.state === "excluded") ? (
                <button
                  type="button"
                  className={btn}
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
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canWrite && waiting > 0 ? (
        <div className="space-y-3 rounded-md border border-border p-3">
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
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-5"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />
            I have checked the list and the wording of the email.
          </label>
          <button
            type="button"
            className={btnPrimary}
            disabled={pending || !checked || surveyState !== "open"}
            onClick={() =>
              run(() => approveInvitesAction(workspaceId, surveyId))
            }
          >
            {pending
              ? "Sending…"
              : `Approve and send ${waiting} ${waiting === 1 ? "invitation" : "invitations"}`}
          </button>
        </div>
      ) : null}
      {canWrite && surveyState === "open" && remindable > 0 ? (
        <div className="space-y-2 rounded-md border border-border p-3">
          <p className="text-sm">
            {remindable} {remindable === 1 ? "person has" : "people have"} not
            answered yet. You can send each of them one reminder (never more).
          </p>
          <button
            type="button"
            className={btn}
            disabled={pending}
            onClick={() =>
              run(() => remindInvitesAction(workspaceId, surveyId))
            }
          >
            Send one reminder to {remindable}{" "}
            {remindable === 1 ? "person" : "people"}
          </button>
        </div>
      ) : null}
      {canWrite &&
      surveyState === "open" &&
      invites.some((i) => i.state === "manual") ? (
        <div className="space-y-2 rounded-md border border-border p-3">
          <button
            type="button"
            className={btn}
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
          </button>
          {links ? (
            <>
              <p className="text-sm text-muted">
                Each link is for one person and takes one answer. Anyone who has
                it can answer for them, so give it only to that person.
              </p>
              <label htmlFor="manual-links" className="sr-only">
                Personal links, one per line
              </label>
              <textarea
                id="manual-links"
                readOnly
                rows={Math.min(links.length + 1, 10)}
                className="block w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
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
