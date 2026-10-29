"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { toast } from "sonner";
import {
  approveAction,
  cancelAction,
  excludeAction,
  includeAction,
} from "@/app/(app)/w/[workspaceId]/outreach/actions";
import type { components } from "@/lib/api/schema.gen";
import { cn } from "@/lib/utils";
import { plural } from "@/lib/format";
import { link } from "@/components/ui";
import { FormError } from "./form-message";
import { OutreachApprove } from "./outreach-approve";
import { OutreachMessage, type SaveState } from "./outreach-message";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Batch = components["schemas"]["OutreachBatch"];
type Message = components["schemas"]["OutreachMessage"];

export function OutreachReview({
  workspaceId,
  batch,
  canEdit,
  senderName,
  senderAddress,
  replyTo,
  emailConfigured,
}: {
  workspaceId: string;
  batch: Batch;
  canEdit: boolean;
  senderName: string;
  senderAddress?: string;
  replyTo?: string;
  emailConfigured: boolean;
}) {
  const drafts = useMemo(
    () => batch.messages.filter((m) => m.state === "draft"),
    [batch.messages],
  );
  const selectable = useMemo(
    () =>
      batch.messages.filter(
        (m) => m.state === "draft" || m.state === "excluded",
      ),
    [batch.messages],
  );
  const left = batch.messages.filter(
    (m) => m.state === "excluded" || m.state === "suppressed",
  ).length;
  const ready = drafts.length;

  const [expandedId, setExpandedId] = useState<string | undefined>(
    () => drafts[0]?.id,
  );
  const [opened, setOpened] = useState<Set<string>>(
    () => new Set(drafts[0] ? [drafts[0].id] : []),
  );
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewId, setPreviewId] = useState<string>();
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  const preview: Message | undefined = previewId
    ? batch.messages.find((m) => m.id === previewId)
    : undefined;
  const dirtyCount = Object.values(saveStates).filter(
    (s) => s === "dirty" || s === "saving" || s === "error",
  ).length;
  const openedDrafts = drafts.filter((m) => opened.has(m.id)).length;
  const unseen = drafts.length - openedDrafts;
  const allSelected =
    selectable.length > 0 &&
    selectable.every((m) => selected.has(m.id));
  const disabledReason =
    dirtyCount > 0
      ? "Save your edits before sending."
      : ready === 0
        ? "Nobody is ready to send to yet."
        : undefined;

  function toggle(message: Message) {
    setExpandedId((current) => (current === message.id ? undefined : message.id));
    setOpened((current) => new Set(current).add(message.id));
  }

  function select(id: string, on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function bulk(kind: "exclude" | "include") {
    const ids = selectable
      .filter((m) =>
        kind === "exclude"
          ? m.state === "draft" && selected.has(m.id)
          : m.state === "excluded" && selected.has(m.id),
      )
      .map((m) => m.id);
    if (ids.length === 0) return;
    setError(undefined);
    start(async () => {
      for (const id of ids) {
        const res =
          kind === "exclude"
            ? await excludeAction(workspaceId, batch.id, id)
            : await includeAction(workspaceId, batch.id, id);
        if (res?.error) {
          setError(res.error);
          return;
        }
      }
      setSelected(new Set());
      setSaveStates((current) => {
        const next = { ...current };
        for (const id of ids) delete next[id];
        return next;
      });
      const n = ids.length;
      toast(
        `${n} ${n === 1 ? "person" : "people"} ${
          kind === "exclude" ? "left out" : "included again"
        }`,
        {
          action: {
            label: "Undo",
            onClick: () =>
              start(async () => {
                for (const id of ids) {
                  await (kind === "exclude" ? includeAction : excludeAction)(
                    workspaceId,
                    batch.id,
                    id,
                  );
                }
              }),
          },
        },
      );
    });
  }

  function approve() {
    setError(undefined);
    start(async () => {
      const res = await approveAction(workspaceId, batch.id);
      setConfirming(false);
      if (res?.error) setError(res.error);
      else toast.success("Sending now");
    });
  }

  function cancel() {
    setError(undefined);
    start(async () => {
      const res = await cancelAction(workspaceId, batch.id);
      setCancelling(false);
      if (res?.error) setError(res.error);
    });
  }

  function exportCsv() {
    const cell = (value: unknown) =>
      `"${String(value ?? "").replace(/"/g, '""')}"`;
    const header = [
      "Person",
      "Email",
      "Company",
      "State",
      "Subject",
      "Body",
      "Based on",
      "Sent at",
      "Error",
    ];
    const rows = batch.messages.map((m) => [
      m.personName,
      m.toEmail,
      m.accountName ?? "",
      m.state,
      m.subject,
      m.body,
      m.quotes.map((q) => q.text).join(" | "),
      m.sentAt ?? "",
      m.error ?? "",
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map(cell).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${
      batch.requestTitle
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase() || "messages"
    }.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const groups = useMemo(() => {
    const map = new Map<string, Message[]>();
    for (const m of batch.messages) {
      const key = m.accountName ?? "";
      const list = map.get(key) ?? [];
      list.push(m);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [batch.messages]);

  return (
    <>
      {batch.state === "review" && canEdit ? (
        <div
          role="region"
          aria-label="Review progress"
          className="sticky top-14 z-20 rounded-xl border border-border bg-background/95 px-4 py-3 shadow-card backdrop-blur md:top-0"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium" aria-live="polite">
                {openedDrafts} of {drafts.length}{" "}
                {drafts.length === 1 ? "message" : "messages"} opened
              </p>
              <p className="text-xs text-muted-foreground">
                {ready} ready · {left} left out
                {dirtyCount > 0 ? ` · ${dirtyCount} unsaved` : ""}
              </p>
              <Progress
                value={drafts.length === 0 ? 0 : (openedDrafts / drafts.length) * 100}
                className="mt-2 h-1 w-40 max-w-full"
                aria-label="Messages opened"
              />
            </div>
            <Button
              type="button"
              disabled={pending || ready === 0 || dirtyCount > 0}
              title={disabledReason}
              onClick={() => setConfirming(true)}
            >
              {ready > 0
                ? `Approve and send ${plural(ready, "message")}`
                : "Approve and send"}
            </Button>
          </div>
        </div>
      ) : null}

      {!emailConfigured ? (
        <Card
          role="note"
          className="[--card-spacing:0px] space-y-1 bg-tint-amber p-4 text-sm"
        >
          <p className="font-medium">Email is not set up here yet</p>
          <p className="text-muted-foreground">
            You can edit and approve, but nothing is sent until a sending
            address is configured. Tests cannot be sent either.
          </p>
        </Card>
      ) : null}

      {batch.noEmail > 0 || batch.anonymousQuotes > 0 ? (
        <Card
          role="note"
          className="[--card-spacing:0px] space-y-1 bg-tint-amber p-4 text-sm"
        >
          <p className="font-medium">People we can&apos;t write to</p>
          {batch.noEmail > 0 ? (
            <p className="text-muted-foreground">
              {plural(batch.noEmail, "person", "people")} asked for this but we
              have no email address for them.{" "}
              <Link href={`/w/${workspaceId}/people`} className={link}>
                Open people
              </Link>
            </p>
          ) : null}
          {batch.anonymousQuotes > 0 ? (
            <p className="text-muted-foreground">
              {plural(batch.anonymousQuotes, "quote")} came from someone we
              haven&apos;t recorded, so we can&apos;t tell them.
            </p>
          ) : null}
        </Card>
      ) : null}

      {batch.messages.length === 0 && batch.state !== "drafting" ? (
        <Card className="[--card-spacing:0px] space-y-1 p-4 text-sm">
          <p className="font-medium">No one to write to</p>
          <p className="text-muted-foreground">
            Nobody connected to this request has an email address, and no quote
            came from a recorded person.{" "}
            <Link
              href={`/w/${workspaceId}/requests/${batch.requestId}`}
              className={link}
            >
              Open the request
            </Link>
          </p>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {plural(batch.messages.length, "message")}
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={exportCsv}
          disabled={batch.messages.length === 0}
        >
          <Download aria-hidden="true" />
          Export CSV
        </Button>
      </div>

      {batch.state === "review" && canEdit && selectable.length > 1 ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Checkbox
              checked={
                allSelected ? true : selected.size > 0 ? "indeterminate" : false
              }
              onCheckedChange={(value) =>
                setSelected(
                  value === true
                    ? new Set(selectable.map((m) => m.id))
                    : new Set(),
                )
              }
              aria-label="Select every message"
            />
            Select all {selectable.length}
          </label>
          {selected.size > 0 ? (
            <div
              role="region"
              aria-label="Bulk actions"
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm shadow-xs"
            >
              <span>{selected.size} selected</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => bulk("exclude")}
              >
                Don&apos;t send
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => bulk("include")}
              >
                Include again
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setSelected(new Set())}
              >
                Clear
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <FormError message={error} />

      {groups.map(([account, messages]) => (
        <div key={account || "none"} className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-muted-foreground">
              {account || "No company recorded"}
            </h2>
            <span className="text-xs text-muted-foreground">
              {plural(messages.length, "person", "people")}
            </span>
          </div>
          <ul className="space-y-3">
            {messages.map((m) => (
              <OutreachMessage
                key={m.id}
                workspaceId={workspaceId}
                batchId={batch.id}
                batchState={batch.state}
                message={m}
                canEdit={canEdit}
                emailConfigured={emailConfigured}
                expanded={expandedId === m.id}
                onToggle={() => toggle(m)}
                selected={selected.has(m.id)}
                onSelect={(on) => select(m.id, on)}
                onSaveState={(state) =>
                  setSaveStates((current) =>
                    current[m.id] === state
                      ? current
                      : { ...current, [m.id]: state },
                  )
                }
                onPreview={() => setPreviewId(m.id)}
              />
            ))}
          </ul>
        </div>
      ))}

      {batch.state === "review" && canEdit ? (
        <OutreachApprove
          ready={ready}
          left={left}
          opened={openedDrafts}
          total={drafts.length}
          senderName={senderName}
          senderAddress={senderAddress}
          replyTo={replyTo}
          onApprove={() => setConfirming(true)}
          onCancel={() => setCancelling(true)}
          approveDisabled={pending || dirtyCount > 0}
          disabledReason={disabledReason}
        />
      ) : null}

      <Sheet
        open={Boolean(preview)}
        onOpenChange={(open) => {
          if (!open) setPreviewId(undefined);
        }}
      >
        <SheetContent
          side="right"
          className="w-full overflow-y-auto sm:max-w-lg"
        >
          <SheetHeader className="gap-1">
            <SheetTitle>Preview</SheetTitle>
            <p className="text-sm text-muted-foreground">
              What the recipient will see. The link to stop updates is added
              when it is sent.
            </p>
          </SheetHeader>
          {preview ? (
            <div className="space-y-4 px-4 pb-6">
              <div className="flex gap-2" role="group" aria-label="Preview width">
                <Button
                  type="button"
                  size="sm"
                  variant={device === "desktop" ? "secondary" : "ghost"}
                  onClick={() => setDevice("desktop")}
                >
                  Desktop
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={device === "mobile" ? "secondary" : "ghost"}
                  onClick={() => setDevice("mobile")}
                >
                  Phone
                </Button>
              </div>
              <div
                className={cn(
                  "mx-auto w-full rounded-xl border border-border bg-card p-4 shadow-xs",
                  device === "mobile" && "max-w-[22rem]",
                )}
              >
                <dl className="space-y-1 border-b border-border pb-3 text-sm">
                  <div className="flex gap-2">
                    <dt className="w-16 shrink-0 text-muted-foreground">From</dt>
                    <dd>
                      {senderName}
                      {senderAddress ? ` <${senderAddress}>` : ""}
                    </dd>
                  </div>
                  {replyTo ? (
                    <div className="flex gap-2">
                      <dt className="w-16 shrink-0 text-muted-foreground">
                        Reply-to
                      </dt>
                      <dd className="min-w-0 break-all">{replyTo}</dd>
                    </div>
                  ) : null}
                  <div className="flex gap-2">
                    <dt className="w-16 shrink-0 text-muted-foreground">To</dt>
                    <dd className="min-w-0 break-all">{preview.toEmail}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-16 shrink-0 text-muted-foreground">
                      Subject
                    </dt>
                    <dd className="font-medium">{preview.subject}</dd>
                  </div>
                </dl>
                <p className="mt-4 whitespace-pre-wrap text-sm">
                  {preview.body}
                </p>
                <p className="mt-6 border-t border-border pt-3 text-xs text-muted-foreground">
                  You are getting this because you asked for this. A link to
                  stop getting updates like this is added to every email.
                </p>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Send {plural(ready, "email")} now?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {plural(ready, "person", "people")} will each get one email from{" "}
              {senderName}. This can&apos;t be undone.
              {unseen > 0
                ? ` You have not opened ${plural(unseen, "message")} yet.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Not yet</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                approve();
              }}
            >
              {pending ? "Sending…" : `Yes, send ${plural(ready, "email")}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={cancelling} onOpenChange={setCancelling}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this batch?</AlertDialogTitle>
            <AlertDialogDescription>
              No emails will be sent and the drafts are discarded. The request
              is not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>
              Keep the batch
            </AlertDialogCancel>
            <AlertDialogAction
              variant="danger"
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                cancel();
              }}
            >
              {pending ? "Cancelling…" : "Yes, cancel it"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
