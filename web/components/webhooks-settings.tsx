"use client";

import { useActionState, useState, useTransition } from "react";
import {
  createWebhookAction,
  deleteWebhookAction,
  rotateWebhookSecretAction,
  setWebhookEnabledAction,
  testWebhookAction,
  updateWebhookAction,
  webhookDeliveriesAction,
  type WebhookDelivery,
} from "@/app/(app)/w/[workspaceId]/settings/actions";
import { keepForm } from "@/lib/keep-form";
import { FormError } from "./form-message";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LocalTime } from "./local-time";

type Endpoint = {
  id: string;
  url: string;
  description: string;
  events: string[];
  enabled: boolean;
  pausedReason: string;
  consecutiveFailures: number;
  format: "json" | "slack" | "discord" | "teams";
};

const FORMAT_LABELS: Record<string, string> = {
  json: "Signed data for a program or an automation service",
  slack: "A message for a Slack channel",
  discord: "A message for a Discord channel",
  teams: "A message for a Microsoft Teams channel",
};

const EVENT_LABELS: Record<string, string> = {
  "request.created": "A new request is created",
  "request.status_changed": "A request's status changes",
  "suggestions.ready": "New suggestions are ready to review",
  "release_note.published": "A release note is published",
  "survey.response_completed": "Someone finishes a survey",
};

function Row({
  workspaceId,
  e,
  events,
}: {
  workspaceId: string;
  e: Endpoint;
  events: string[];
}) {
  const [error, setError] = useState<string>();
  const [note, setNote] = useState<string>();
  const [secret, setSecret] = useState<string>();
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>();
  const [rotating, setRotating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editState, editAction, editPending] = useActionState(
    updateWebhookAction.bind(null, workspaceId, e.id),
    undefined,
  );
  const [removing, setRemoving] = useState(false);
  const [pending, start] = useTransition();
  const run = (f: () => Promise<{ error?: string } | undefined>) =>
    start(async () => {
      setError(undefined);
      setNote(undefined);
      const r = await f();
      if (r?.error) setError(r.error);
    });
  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <span className="min-w-0">
          <strong className="break-all">{e.url}</strong>
          {e.description ? (
            <span className="block text-muted-foreground">{e.description}</span>
          ) : null}
          <span className="block text-muted-foreground">
            {e.events.map((x) => EVENT_LABELS[x] ?? x).join("; ")}
          </span>
          <span className="block text-muted-foreground">
            {FORMAT_LABELS[e.format] ?? e.format}
          </span>
          <span className="block">
            {e.enabled
              ? "On"
              : `Off${e.pausedReason ? `: ${e.pausedReason}` : ""}`}
          </span>
        </span>
        <span className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            aria-expanded={editing}
            onClick={() => setEditing((v) => !v)}
          >
            {editing ? "Close" : "Edit"}
            <span className="sr-only"> {e.url}</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() =>
              run(() =>
                setWebhookEnabledAction(workspaceId, e.id, !e.enabled, {
                  url: e.url,
                  description: e.description,
                  events: e.events,
                  format: e.format,
                }),
              )
            }
          >
            {e.enabled ? "Switch off" : "Switch on"}
            <span className="sr-only"> {e.url}</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() =>
              run(async () => {
                const r = await testWebhookAction(workspaceId, e.id);
                if (!r?.error)
                  setNote(
                    "A test message is on its way. Refresh the history in a few seconds.",
                  );
                return r;
              })
            }
          >
            Send a test
            <span className="sr-only"> to {e.url}</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() =>
              run(async () => {
                const r = await webhookDeliveriesAction(workspaceId, e.id);
                setDeliveries(r.deliveries);
                return r;
              })
            }
          >
            {deliveries ? "Refresh history" : "Show history"}
            <span className="sr-only"> for {e.url}</span>
          </Button>
          <AlertDialog open={rotating} onOpenChange={setRotating}>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="outline" disabled={pending}>
                New secret
                <span className="sr-only"> for {e.url}</span>
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Make a new signing secret?</AlertDialogTitle>
                <AlertDialogDescription>
                  Messages signed with the old one will stop verifying.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={pending}>
                  Keep it
                </AlertDialogCancel>
                <AlertDialogAction
                  disabled={pending}
                  onClick={(event) => {
                    event.preventDefault();
                    setRotating(false);
                    run(async () => {
                      const r = await rotateWebhookSecretAction(
                        workspaceId,
                        e.id,
                      );
                      setSecret(r.secret);
                      return r;
                    });
                  }}
                >
                  New secret
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <AlertDialog open={removing} onOpenChange={setRemoving}>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="outline" disabled={pending}>
                Remove
                <span className="sr-only"> {e.url}</span>
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Remove this address and its history?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Nothing more will be sent to it.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={pending}>
                  Keep it
                </AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  disabled={pending}
                  onClick={(event) => {
                    event.preventDefault();
                    setRemoving(false);
                    run(() => deleteWebhookAction(workspaceId, e.id));
                  }}
                >
                  Remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </span>
      </div>
      {editing ? (
        <form action={editAction} className="space-y-3 rounded-xl border border-border p-3">
          <input type="hidden" name="enabled" value={e.enabled ? "yes" : "no"} />
          <EndpointFields
            prefix={`hook-edit-${e.id}`}
            events={events}
            endpoint={e}
          />
          <FormError message={editState?.error} />
          {editState?.notice ? (
            <p role="status" className="text-sm text-muted-foreground">
              {editState.notice}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={editPending}>
              {editPending ? "Saving…" : "Save"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
      <FormError message={error} />
      {note ? (
        <p role="status" className="text-sm text-muted-foreground">
          {note}
        </p>
      ) : null}
      {secret ? (
        <div
          role="status"
          className="space-y-1 rounded-xl border border-border p-3"
        >
          <Label
            htmlFor={`secret-${e.id}`}
            className="block text-sm font-medium"
          >
            New signing secret. Copy it now: it is shown only once.
          </Label>
          <Input
            id={`secret-${e.id}`}
            readOnly
            value={secret}
            className="font-mono text-sm"
          />
        </div>
      ) : null}
      {deliveries ? (
        deliveries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing has been sent yet.
          </p>
        ) : (
          <ul
            className="text-sm text-muted-foreground"
            aria-label="Recent messages"
          >
            {deliveries.map((d) => (
              <li key={d.id}>
                <LocalTime iso={d.createdAt} time /> ·{" "}
                {EVENT_LABELS[d.eventType] ?? d.eventType} ·{" "}
                {d.state === "sent"
                  ? "delivered"
                  : d.state === "failed"
                    ? `gave up after ${d.attempts} tries`
                    : d.attempts === 0
                      ? "waiting to be sent"
                      : `will try again (${d.attempts} so far)`}
                {d.lastError ? ` · ${d.lastError}` : ""}
              </li>
            ))}
          </ul>
        )
      ) : null}
    </li>
  );
}

/** The fields that make up an address, shared by the add form and the edit form (which is why ids take a prefix). */
function EndpointFields({
  prefix,
  events,
  endpoint,
}: {
  prefix: string;
  /** The events this workspace can subscribe to, in the order to show them. */
  events: string[];
  endpoint?: Endpoint;
}) {
  return (
    <>
      <div>
        <Label
          htmlFor={`${prefix}-url`}
          className="mb-1 block text-sm font-medium"
        >
          Address (must start with https://)
        </Label>
        <Input
          id={`${prefix}-url`}
          name="url"
          type="url"
          required
          maxLength={2000}
          defaultValue={endpoint?.url}
          placeholder="https://example.com/hooks/feedback"
          className="max-w-xl"
        />
      </div>
      <div>
        <Label
          htmlFor={`${prefix}-desc`}
          className="mb-1 block text-sm font-medium"
        >
          Note for yourself (optional)
        </Label>
        <Input
          id={`${prefix}-desc`}
          name="description"
          maxLength={200}
          defaultValue={endpoint?.description}
          className="max-w-xl"
        />
      </div>
      <div>
        <Label
          htmlFor={`${prefix}-format`}
          className="mb-1 block text-sm font-medium"
        >
          What kind of address is it
        </Label>
        <Select name="format" defaultValue={endpoint?.format ?? "json"}>
          <SelectTrigger
            id={`${prefix}-format`}
            className="w-full max-w-xl"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(FORMAT_LABELS).map(([v, l]) => (
              <SelectItem key={v} value={v}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="mt-1 text-sm text-muted-foreground">
          For a chat channel, make an incoming webhook there and paste its
          address above; messages then arrive as plain sentences.
        </p>
      </div>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Send a message when</legend>
        {events.map((ev) => (
          <div key={ev} className="flex items-start gap-3">
            <Checkbox
              id={`${prefix}-ev-${ev}`}
              name="events"
              value={ev}
              defaultChecked={endpoint ? endpoint.events.includes(ev) : true}
            />
            <Label
              htmlFor={`${prefix}-ev-${ev}`}
              className="text-sm leading-normal font-normal"
            >
              {EVENT_LABELS[ev] ?? ev}
            </Label>
          </div>
        ))}
      </fieldset>
    </>
  );
}

export function WebhooksSettings({
  workspaceId,
  available,
  events,
  endpoints,
}: {
  workspaceId: string;
  available: boolean;
  events: string[];
  endpoints: Endpoint[];
}) {
  const [state, action, pending] = useActionState(
    createWebhookAction.bind(null, workspaceId),
    undefined,
  );
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Send a message to a web address whenever something happens, so other
        tools (an automation service, a chat channel, your own code) can react.
        Messages carry ids, names and titles of your requests, never customer
        quotes or email addresses. Each one is signed, so the receiver can check
        it came from here.
      </p>
      {!available ? (
        <p role="status" className="text-sm">
          This server has no secrets key yet, so addresses cannot be added.
        </p>
      ) : (
        <form method="post" onSubmit={keepForm(action)} className="space-y-3">
          <EndpointFields prefix="hook-new" events={events} />
          <Button type="submit" disabled={pending}>
            Add address
          </Button>
        </form>
      )}
      <FormError message={state?.error} />
      {state?.secret ? (
        <div
          role="status"
          className="space-y-2 rounded-xl border border-border p-3"
        >
          <Label
            id="hook-secret-label"
            htmlFor="hook-secret"
            className="block text-sm font-medium"
          >
            Signing secret for {state.url}. Copy it now: it is shown only once.
          </Label>
          <Input
            id="hook-secret"
            readOnly
            value={state.secret}
            className="font-mono text-sm"
          />
          <p className="text-sm text-muted-foreground">
            Each message has a <code>Webhook-Signature</code> header like{" "}
            <code>t=1700000000,v1=…</code>. Compute an HMAC-SHA256 of the time,
            a dot, and the raw body with this secret, compare it with{" "}
            <code>v1</code>, and ignore messages whose time is more than a few
            minutes old. <code>Webhook-Id</code> is the same on every retry, so
            you can drop duplicates.
          </p>
        </div>
      ) : null}
      {endpoints.length === 0 ? (
        <p className="text-sm text-muted-foreground">No addresses yet.</p>
      ) : (
        <ul className="divide-y divide-border text-sm" aria-label="Addresses">
          {endpoints.map((e) => (
            <Row
              key={e.id}
              workspaceId={workspaceId}
              e={e}
              events={events}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
