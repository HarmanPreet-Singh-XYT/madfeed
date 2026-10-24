"use client";

import { useActionState, useState, useTransition } from "react";
import {
  createWebhookAction,
  deleteWebhookAction,
  rotateWebhookSecretAction,
  setWebhookEnabledAction,
  testWebhookAction,
  webhookDeliveriesAction,
  type WebhookDelivery,
} from "@/app/(app)/w/[workspaceId]/settings/actions";
import { keepForm } from "@/lib/keep-form";
import { FormError } from "./form-message";
import { btn, btnPrimary, field } from "./ui";

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

function Row({ workspaceId, e }: { workspaceId: string; e: Endpoint }) {
  const [error, setError] = useState<string>();
  const [note, setNote] = useState<string>();
  const [secret, setSecret] = useState<string>();
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>();
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
            <span className="block text-muted">{e.description}</span>
          ) : null}
          <span className="block text-muted">
            {e.events.map((x) => EVENT_LABELS[x] ?? x).join("; ")}
          </span>
          <span className="block text-muted">
            {FORMAT_LABELS[e.format] ?? e.format}
          </span>
          <span className="block">
            {e.enabled
              ? "On"
              : `Off${e.pausedReason ? `: ${e.pausedReason}` : ""}`}
          </span>
        </span>
        <span className="flex flex-wrap gap-2">
          <button
            type="button"
            className={btn}
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
          </button>
          <button
            type="button"
            className={btn}
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
          </button>
          <button
            type="button"
            className={btn}
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
          </button>
          <button
            type="button"
            className={btn}
            disabled={pending}
            onClick={() =>
              run(async () => {
                if (
                  !window.confirm(
                    "Make a new signing secret? Messages signed with the old one will stop verifying.",
                  )
                )
                  return undefined;
                const r = await rotateWebhookSecretAction(workspaceId, e.id);
                setSecret(r.secret);
                return r;
              })
            }
          >
            New secret
            <span className="sr-only"> for {e.url}</span>
          </button>
          <button
            type="button"
            className={btn}
            disabled={pending}
            onClick={() =>
              run(async () => {
                if (
                  !window.confirm(
                    "Remove this address and its history? Nothing more will be sent to it.",
                  )
                )
                  return undefined;
                return deleteWebhookAction(workspaceId, e.id);
              })
            }
          >
            Remove
            <span className="sr-only"> {e.url}</span>
          </button>
        </span>
      </div>
      <FormError message={error} />
      {note ? (
        <p role="status" className="text-sm text-muted">
          {note}
        </p>
      ) : null}
      {secret ? (
        <div
          role="status"
          className="space-y-1 rounded-md border border-border p-3"
        >
          <label
            htmlFor={`secret-${e.id}`}
            className="block text-sm font-medium"
          >
            New signing secret. Copy it now: it is shown only once.
          </label>
          <input
            id={`secret-${e.id}`}
            readOnly
            value={secret}
            className={`${field} font-mono text-sm`}
          />
        </div>
      ) : null}
      {deliveries ? (
        deliveries.length === 0 ? (
          <p className="text-sm text-muted">Nothing has been sent yet.</p>
        ) : (
          <ul className="text-sm text-muted" aria-label="Recent messages">
            {deliveries.map((d) => (
              <li key={d.id}>
                {new Date(d.createdAt).toLocaleString()} ·{" "}
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
      <p className="text-sm text-muted">
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
          <div>
            <label
              htmlFor="hook-url"
              className="mb-1 block text-sm font-medium"
            >
              Address (must start with https://)
            </label>
            <input
              id="hook-url"
              name="url"
              type="url"
              required
              maxLength={2000}
              placeholder="https://example.com/hooks/feedback"
              className={`${field} max-w-xl`}
            />
          </div>
          <div>
            <label
              htmlFor="hook-desc"
              className="mb-1 block text-sm font-medium"
            >
              Note for yourself (optional)
            </label>
            <input
              id="hook-desc"
              name="description"
              maxLength={200}
              className={`${field} max-w-xl`}
            />
          </div>
          <div>
            <label
              htmlFor="hook-format"
              className="mb-1 block text-sm font-medium"
            >
              What kind of address is it
            </label>
            <select
              id="hook-format"
              name="format"
              defaultValue="json"
              className={`${field} max-w-xl`}
            >
              {Object.entries(FORMAT_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <p className="mt-1 text-sm text-muted">
              For a chat channel, make an incoming webhook there and paste its
              address above; messages then arrive as plain sentences.
            </p>
          </div>
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">Send a message when</legend>
            {events.map((ev) => (
              <div key={ev} className="flex items-start gap-3">
                <input
                  id={`ev-${ev}`}
                  name="events"
                  value={ev}
                  type="checkbox"
                  className="mt-0.5 size-5"
                  defaultChecked
                />
                <label htmlFor={`ev-${ev}`} className="text-sm">
                  {EVENT_LABELS[ev] ?? ev}
                </label>
              </div>
            ))}
          </fieldset>
          <button type="submit" className={btnPrimary} disabled={pending}>
            Add address
          </button>
        </form>
      )}
      <FormError message={state?.error} />
      {state?.secret ? (
        <div
          role="status"
          className="space-y-2 rounded-md border border-border p-3"
        >
          <label htmlFor="hook-secret" className="block text-sm font-medium">
            Signing secret for {state.url}. Copy it now: it is shown only once.
          </label>
          <input
            id="hook-secret"
            readOnly
            value={state.secret}
            className={`${field} font-mono text-sm`}
          />
          <p className="text-sm text-muted">
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
        <p className="text-sm text-muted">No addresses yet.</p>
      ) : (
        <ul className="divide-y divide-border text-sm" aria-label="Addresses">
          {endpoints.map((e) => (
            <Row key={e.id} workspaceId={workspaceId} e={e} />
          ))}
        </ul>
      )}
    </div>
  );
}
