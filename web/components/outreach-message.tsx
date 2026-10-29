"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Check, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import {
  excludeAction,
  includeAction,
  retryAction,
  saveMessageFieldsAction,
  sendTestMessageAction,
} from "@/app/(app)/w/[workspaceId]/outreach/actions";
import type { components } from "@/lib/api/schema.gen";
import { cn } from "@/lib/utils";
import { link } from "@/components/ui";
import { FormError } from "./form-message";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LocalTime } from "./local-time";

type Message = components["schemas"]["OutreachMessage"];

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

// A state is always written out; the tint is only a second cue.
const STATE_TINT: Record<
  string,
  "muted" | "tint-teal" | "tint-amber" | "tint-coral" | "tint-blue"
> = {
  drafting: "tint-blue",
  draft: "muted",
  approved: "tint-amber",
  sending: "tint-amber",
  sent: "tint-teal",
  failed: "tint-coral",
  excluded: "muted",
  suppressed: "muted",
};

const STATE_LABEL: Record<string, string> = {
  drafting: "Being written…",
  draft: "Draft",
  approved: "Approved, waiting to send",
  sending: "Sending…",
  sent: "Sent",
  failed: "Could not be sent",
  excluded: "Left out",
  suppressed: "Asked not to be emailed",
};

export function OutreachMessage({
  workspaceId,
  batchId,
  batchState,
  message,
  canEdit,
  emailConfigured,
  expanded,
  onToggle,
  selected,
  onSelect,
  onSaveState,
  onPreview,
}: {
  workspaceId: string;
  batchId: string;
  batchState: string;
  message: Message;
  canEdit: boolean;
  emailConfigured: boolean;
  expanded: boolean;
  onToggle: () => void;
  selected: boolean;
  onSelect: (selected: boolean) => void;
  onSaveState: (state: SaveState) => void;
  onPreview: () => void;
}) {
  const [subject, setSubject] = useState(message.subject);
  const [body, setBody] = useState(message.body);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [edited, setEdited] = useState(message.edited);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const version = useRef(0);
  const dirty = useRef(false);
  const saving = useRef(false);
  const queued = useRef<{ subject: string; body: string } | null>(null);
  const panelId = `message-${message.id}`;
  const editable =
    message.state === "draft" && batchState === "review" && canEdit;
  const selectable =
    editable ||
    (message.state === "excluded" && batchState === "review" && canEdit);
  const firstName = message.personName.split(" ")[0];

  function report(state: SaveState) {
    setSaveState(state);
    onSaveState(state);
  }

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function save(nextSubject = subject, nextBody = body) {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (saving.current) {
      queued.current = { subject: nextSubject, body: nextBody };
      return;
    }
    const at = version.current;
    setError(undefined);
    report("saving");
    saving.current = true;
    let failed = false;
    try {
      const res = await saveMessageFieldsAction(
        workspaceId,
        batchId,
        message.id,
        nextSubject,
        nextBody,
      );
      if (res?.error) {
        failed = true;
        report("error");
        setError(res.error);
      } else if (at !== version.current) {
        report("dirty");
      } else {
        dirty.current = false;
        setEdited(true);
        report("saved");
      }
    } finally {
      saving.current = false;
    }
    if (!failed && queued.current) {
      const next = queued.current;
      queued.current = null;
      void save(next.subject, next.body);
    }
  }

  function change(nextSubject: string, nextBody: string) {
    version.current += 1;
    dirty.current = true;
    report("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(nextSubject, nextBody), 900);
  }

  function run(
    fn: () => Promise<{ error?: string } | undefined>,
    done?: string,
  ) {
    setError(undefined);
    start(async () => {
      const res = await fn();
      if (res?.error) {
        setError(res.error);
        return;
      }
      if (done) toast(done);
    });
  }

  function testSend() {
    setError(undefined);
    start(async () => {
      const res = await sendTestMessageAction(
        workspaceId,
        batchId,
        message.id,
        subject,
        body,
      );
      if (res?.error) {
        setError(res.error);
        return;
      }
      toast.success("Test sent to your inbox");
    });
  }

  function exclude() {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    version.current += 1;
    dirty.current = false;
    report("idle");
    start(async () => {
      const res = await excludeAction(workspaceId, batchId, message.id);
      if (res?.error) {
        setError(res.error);
        return;
      }
      toast(`${firstName} left out`, {
        action: {
          label: "Undo",
          onClick: () =>
            start(async () => {
              const back = await includeAction(
                workspaceId,
                batchId,
                message.id,
              );
              if (back?.error) toast.error(back.error);
            }),
        },
      });
    });
  }

  return (
    <Card
      asChild
      className="[--card-spacing:0px] overflow-hidden"
      data-state={message.state}
    >
      <li>
        <div className="flex items-start gap-2 px-4 py-3">
          {selectable ? (
            <Checkbox
              checked={selected}
              onCheckedChange={(value) => onSelect(value === true)}
              aria-label={`Select ${message.personName}`}
              className="mt-4"
            />
          ) : null}
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-controls={panelId}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <span
              aria-hidden="true"
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-link"
            >
              {message.personName.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">
                  {message.personName}
                </span>
                <Badge
                  variant={STATE_TINT[message.state] ?? "muted"}
                  data-state={message.state}
                  className="h-5 px-2"
                >
                  {STATE_LABEL[message.state] ?? message.state}
                  {message.sentAt ? (
                    <>
                      {" · "}
                      <LocalTime iso={message.sentAt} time />
                    </>
                  ) : null}
                </Badge>
                {edited ? (
                  <Badge variant="outline" className="h-5 px-2">
                    Edited
                  </Badge>
                ) : null}
              </span>
              <span className="mt-0.5 block truncate text-sm text-muted-foreground">
                {message.toEmail}
                {message.accountName ? ` · ${message.accountName}` : ""}
              </span>
            </span>
            <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
              {message.quotes.length === 0
                ? "No quote"
                : `${message.quotes.length} ${
                    message.quotes.length === 1 ? "quote" : "quotes"
                  }`}
            </span>
            <ChevronDown
              aria-hidden="true"
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform",
                expanded && "rotate-180",
              )}
            />
          </button>
        </div>

        <div
          id={panelId}
          hidden={!expanded}
          className="space-y-4 border-t border-border px-4 py-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <Link
              href={`/w/${workspaceId}/people?q=${encodeURIComponent(message.toEmail)}`}
              className={link}
            >
              View {message.personName} in People
            </Link>
          </div>
          <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
            {message.quotes.length > 0 ? (
              <div className="space-y-1.5 self-start rounded-lg border border-border border-s-2 border-s-brand-2 bg-muted/50 p-3">
                <p className="text-xs font-medium text-muted-foreground">
                  Based on what they said
                </p>
                <ul className="space-y-2">
                  {message.quotes.map((q) => (
                    <li key={q.evidenceId} className="text-sm text-foreground">
                      “{q.text}”
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="hidden lg:block" />
            )}

            {message.state === "drafting" ? (
              <p className="text-sm text-muted-foreground">Writing a draft…</p>
            ) : editable ? (
              <div className="min-w-0 space-y-3">
                <div>
                  <Label
                    htmlFor={`subject-${message.id}`}
                    className="mb-1 block text-sm font-medium"
                  >
                    Subject
                  </Label>
                  <Input
                    id={`subject-${message.id}`}
                    value={subject}
                    maxLength={200}
                    required
                    onChange={(e) => {
                      setSubject(e.target.value);
                      change(e.target.value, body);
                    }}
                    onBlur={() => {
                      if (dirty.current) void save();
                    }}
                  />
                </div>
                <div>
                  <Label
                    htmlFor={`body-${message.id}`}
                    className="mb-1 block text-sm font-medium"
                  >
                    Message
                  </Label>
                  <Textarea
                    id={`body-${message.id}`}
                    value={body}
                    rows={7}
                    maxLength={4000}
                    required
                    onChange={(e) => {
                      setBody(e.target.value);
                      change(subject, e.target.value);
                    }}
                    onBlur={() => {
                      if (dirty.current) void save();
                    }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  A link to stop getting updates like this is added to the
                  bottom of every email automatically.
                </p>
                <div
                  role="status"
                  aria-live="polite"
                  className="flex min-h-6 items-center gap-1.5 text-xs text-muted-foreground"
                >
                  {saveState === "saving" ? "Saving…" : null}
                  {saveState === "saved" ? (
                    <>
                      <Check
                        aria-hidden="true"
                        className="size-3.5 text-hue-teal"
                      />
                      Saved
                    </>
                  ) : null}
                  {saveState === "dirty" ? (
                    <span className="text-hue-amber">Unsaved changes</span>
                  ) : null}
                  {saveState === "error" ? (
                    <span className="text-destructive">Not saved</span>
                  ) : null}
                </div>
                <FormError message={error} />
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pending || saveState === "saving"}
                    onClick={() => void save()}
                  >
                    Save now
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onPreview}
                  >
                    Preview
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={
                      pending ||
                      !emailConfigured ||
                      !subject.trim() ||
                      !body.trim()
                    }
                    title={
                      emailConfigured
                        ? undefined
                        : "Email is not set up in this environment yet."
                    }
                    onClick={testSend}
                  >
                    Send test
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={exclude}
                  >
                    Don&apos;t send to {firstName}
                  </Button>
                </div>
                {!emailConfigured ? (
                  <p className="text-xs text-muted-foreground">
                    Email is not set up in this environment yet, so a test
                    cannot be sent.
                  </p>
                ) : null}
                {message.draftedBy === "fallback" ? (
                  <p className="text-xs text-muted-foreground">
                    This is a plain template. Add anything personal you like
                    before approving.
                  </p>
                ) : null}
              </div>
            ) : message.state !== "excluded" ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">{message.subject}</p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onPreview}
                  >
                    Preview
                  </Button>
                </div>
                <p className="whitespace-pre-wrap text-sm">{message.body}</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                This person will not be emailed. You can include them again.
              </p>
            )}
          </div>

          {message.state === "excluded" &&
          batchState === "review" &&
          canEdit ? (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(
                  () => includeAction(workspaceId, batchId, message.id),
                  `${firstName} included again`,
                )
              }
            >
              Include {firstName} again
            </Button>
          ) : null}

          {message.state === "failed" && canEdit ? (
            <div className="space-y-2">
              <p className="text-sm text-destructive">
                {message.error
                  ? message.error
                  : "The email provider refused this address or message. Check the address, then try again."}
              </p>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  run(
                    () => retryAction(workspaceId, batchId, message.id),
                    "Trying again",
                  )
                }
              >
                Try again
              </Button>
            </div>
          ) : null}
          {!editable ? <FormError message={error} /> : null}
        </div>
      </li>
    </Card>
  );
}
