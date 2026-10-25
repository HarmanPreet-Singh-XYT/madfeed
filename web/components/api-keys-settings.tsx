"use client";

import { useActionState, useState, useTransition } from "react";
import {
  createApiKeyAction,
  keyEventsAction,
  revokeApiKeyAction,
  type KeyEvent,
} from "@/app/(app)/w/[workspaceId]/settings/actions";
import { keepForm } from "@/lib/keep-form";
import { FormError } from "./form-message";
import { btn, btnPrimary, field } from "./ui";

type Key = {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt?: string;
  expiresAt?: string;
  revoked: boolean;
  scopes?: string[];
  allowedCidrs?: string[];
};

const SCOPE_LABELS: Record<string, { label: string; help: string }> = {
  requests: {
    label: "See requests",
    help: "titles, statuses, tags, release notes, and counts of quotes, people and accounts",
  },
  quotes: {
    label: "See customer quotes",
    help: "the exact words behind each request, and searching quotes by meaning",
  },
  ask: {
    label: "Ask questions",
    help: "answers are built from, and cite, stored quotes",
  },
  submit: {
    label: "Add notes to the review queue",
    help: "a person still decides whether a note becomes a request",
  },
  write: {
    label: "Change statuses and add tags",
    help: "it can never mark a request shipped, so nothing is sent to customers",
  },
};

function Activity({
  workspaceId,
  keyId,
}: {
  workspaceId: string;
  keyId: string;
}) {
  const [events, setEvents] = useState<KeyEvent[]>();
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <div className="space-y-1">
      <button
        type="button"
        className={btn}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await keyEventsAction(workspaceId, keyId);
            setError(r.error);
            setEvents(r.events);
          })
        }
      >
        {events ? "Refresh activity" : "Show activity"}
      </button>
      <FormError message={error} />
      {events ? (
        events.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing yet.</p>
        ) : (
          <ul className="text-sm text-muted-foreground" aria-label="Recent activity">
            {events.map((e, i) => (
              <li key={i}>
                {new Date(e.at).toLocaleString()} · {e.action}
                {e.detail ? ` · ${e.detail}` : ""}
                {e.ok ? "" : " · failed"}
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}

export function ApiKeysSettings({
  workspaceId,
  keys,
  apiUrl,
}: {
  workspaceId: string;
  keys: Key[];
  apiUrl: string;
}) {
  const [state, action, pending] = useActionState(
    createApiKeyAction.bind(null, workspaceId),
    undefined,
  );
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Record<string, boolean>>({
    requests: true,
    quotes: true,
    ask: true,
    submit: false,
    write: false,
  });
  const [days, setDays] = useState("0");
  const [addresses, setAddresses] = useState("");
  const [error, setError] = useState<string>();
  const [revoking, startRevoke] = useTransition();
  const active = keys.filter((k) => !k.revoked);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        A key lets a script or an AI assistant look things up, and only as far
        as you allow. It never shows names or email addresses, and it can change
        nothing except adding notes to the review queue, or changing statuses
        and adding tags (if you allow those).
      </p>
      <form method="post" onSubmit={keepForm(action)} className="space-y-3">
        <div>
          <label htmlFor="key-name" className="mb-1 block text-sm font-medium">
            Name for the new key
          </label>
          <input
            id="key-name"
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder="for example, Claude Desktop"
            className={`${field} max-w-sm`}
          />
        </div>
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">What it may do</legend>
          {Object.entries(SCOPE_LABELS).map(([id, s]) => (
            <div key={id} className="flex items-start gap-3">
              <input
                id={`scope-${id}`}
                name={`scope-${id}`}
                type="checkbox"
                className="mt-0.5 size-5"
                checked={scopes[id]}
                onChange={(e) =>
                  setScopes({ ...scopes, [id]: e.target.checked })
                }
              />
              <label htmlFor={`scope-${id}`} className="text-sm">
                <strong>{s.label}</strong>{" "}
                <span className="text-muted-foreground">({s.help})</span>
              </label>
            </div>
          ))}
        </fieldset>
        <div>
          <label htmlFor="key-days" className="mb-1 block text-sm font-medium">
            Lasts
          </label>
          <select
            id="key-days"
            name="days"
            value={days}
            onChange={(e) => setDays(e.target.value)}
            className={field}
          >
            <option value="0">Until I revoke it</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="365">1 year</option>
          </select>
        </div>
        <div>
          <label htmlFor="key-addr" className="mb-1 block text-sm font-medium">
            Only from these addresses (optional, one per line)
          </label>
          <textarea
            id="key-addr"
            name="addresses"
            rows={2}
            value={addresses}
            onChange={(e) => setAddresses(e.target.value)}
            placeholder="203.0.113.7 or 203.0.113.0/24"
            className={field}
          />
        </div>
        <button type="submit" className={btnPrimary} disabled={pending}>
          Create a key
        </button>
      </form>
      <FormError message={state?.error} />
      {state?.secret ? (
        <div
          role="status"
          className="space-y-2 rounded-md border border-border p-3"
        >
          <label htmlFor="key-secret" className="block text-sm font-medium">
            Your new key “{state.name}”. Copy it now: it is shown only once.
          </label>
          <input
            id="key-secret"
            readOnly
            value={state.secret}
            className={`${field} font-mono text-sm`}
          />
          <p className="text-sm text-muted-foreground">
            Keep it secret. Anyone who has it can do what you allowed, from
            wherever you allowed, until it expires or you revoke it.
          </p>
        </div>
      ) : null}
      {active.length === 0 ? (
        <p className="text-sm text-muted-foreground">No active keys.</p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {active.map((k) => (
            <li key={k.id} className="space-y-2 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>
                  <strong>{k.name}</strong>{" "}
                  <span className="font-mono text-muted-foreground">{k.prefix}…</span>
                  <span className="block text-muted-foreground">
                    Can:{" "}
                    {(k.scopes ?? [])
                      .map((s) => SCOPE_LABELS[s]?.label ?? s)
                      .join(", ")}
                    {k.expiresAt
                      ? ` · expires ${new Date(k.expiresAt).toLocaleDateString()}`
                      : " · does not expire"}
                    {k.allowedCidrs && k.allowedCidrs.length > 0
                      ? ` · only from ${k.allowedCidrs.join(", ")}`
                      : ""}
                  </span>
                  <span className="block text-muted-foreground">
                    {k.lastUsedAt
                      ? `Last used ${new Date(k.lastUsedAt).toLocaleDateString()}`
                      : "Never used"}
                  </span>
                </span>
                <button
                  type="button"
                  className={btn}
                  disabled={revoking}
                  onClick={() =>
                    startRevoke(async () => {
                      const r = await revokeApiKeyAction(workspaceId, k.id);
                      setError(r?.error);
                    })
                  }
                >
                  Revoke
                  <span className="sr-only"> {k.name}</span>
                </button>
              </div>
              <Activity workspaceId={workspaceId} keyId={k.id} />
            </li>
          ))}
        </ul>
      )}
      <FormError message={error} />
      <div className="space-y-1">
        <h3 className="font-medium">Use it with an AI assistant</h3>
        <p className="text-sm text-muted-foreground">
          Assistants that connect to a web address can use this one, with the
          key as a bearer token:
        </p>
        <textarea
          readOnly
          aria-label="Hosted MCP address"
          rows={5}
          className={`${field} font-mono text-xs`}
          value={`{
  "mcpServers": {
    "feedback": {
      "url": "${apiUrl}/mcp",
      "headers": { "Authorization": "Bearer fk_… (the key above)" }
    }
  }
}`}
        />
        <p className="text-sm text-muted-foreground">
          Or run the small program on your own computer (
          <code>go build -o feedback-mcp ./cmd/mcp</code> in the api folder):
        </p>
        <textarea
          readOnly
          aria-label="Example assistant settings"
          rows={9}
          className={`${field} font-mono text-xs`}
          value={`{
  "mcpServers": {
    "feedback": {
      "command": "/path/to/feedback-mcp",
      "env": {
        "FEEDBACK_API_URL": "${apiUrl}",
        "FEEDBACK_API_KEY": "fk_… (the key above)"
      }
    }
  }
}`}
        />
        <p className="text-sm text-muted-foreground">
          Customer quotes are untrusted text written by customers. Quotes that
          look like instructions aimed at an AI are held back from assistants,
          and every result says to treat quotes as evidence, not instructions.
          This catches obvious attempts only.
        </p>
      </div>
    </div>
  );
}
