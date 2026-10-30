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
import { Textarea } from "@/components/ui/textarea";
import { LocalTime } from "./local-time";
import { ConfirmDelete } from "./confirm-delete";

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
      <Button
        type="button"
        variant="outline"
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
      </Button>
      <FormError message={error} />
      {events ? (
        events.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing yet.</p>
        ) : (
          <ul
            className="text-sm text-muted-foreground"
            aria-label="Recent activity"
          >
            {events.map((e, i) => (
              <li key={i}>
                <LocalTime iso={e.at} time /> · {e.action}
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
          <Label
            id="key-name-label"
            htmlFor="key-name"
            className="mb-1 block text-sm font-medium"
          >
            Name for the new key
          </Label>
          <Input
            id="key-name"
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder="for example, Claude Desktop"
            className="max-w-sm"
          />
        </div>
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">What it may do</legend>
          {Object.entries(SCOPE_LABELS).map(([id, s]) => (
            <div key={id} className="flex items-start gap-3">
              <Checkbox
                id={`scope-${id}`}
                name={`scope-${id}`}
                checked={scopes[id]}
                onCheckedChange={(checked) =>
                  setScopes({ ...scopes, [id]: checked === true })
                }
              />
              <Label
                htmlFor={`scope-${id}`}
                className="block text-sm leading-normal font-normal"
              >
                <strong>{s.label}</strong>{" "}
                <span className="text-muted-foreground">({s.help})</span>
              </Label>
            </div>
          ))}
        </fieldset>
        <div>
          <Label
            id="key-days-label"
            htmlFor="key-days"
            className="mb-1 block text-sm font-medium"
          >
            Lasts
          </Label>
          <Select name="days" value={days} onValueChange={setDays}>
            <SelectTrigger
              id="key-days"
              className="w-full"
              aria-labelledby="key-days-label"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Until I revoke it</SelectItem>
              <SelectItem value="30">30 days</SelectItem>
              <SelectItem value="90">90 days</SelectItem>
              <SelectItem value="365">1 year</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label
            id="key-addr-label"
            htmlFor="key-addr"
            className="mb-1 block text-sm font-medium"
          >
            Only from these addresses (optional, one per line)
          </Label>
          <Textarea
            id="key-addr"
            name="addresses"
            rows={2}
            value={addresses}
            onChange={(e) => setAddresses(e.target.value)}
            placeholder="203.0.113.7 or 203.0.113.0/24"
          />
        </div>
        <Button type="submit" disabled={pending}>
          Create a key
        </Button>
      </form>
      <FormError message={state?.error} />
      {state?.secret ? (
        <div
          role="status"
          className="space-y-2 rounded-xl border border-border p-3"
        >
          <Label
            id="key-secret-label"
            htmlFor="key-secret"
            className="block text-sm font-medium"
          >
            Your new key “{state.name}”. Copy it now: it is shown only once.
          </Label>
          <Input
            id="key-secret"
            readOnly
            value={state.secret}
            className="font-mono text-sm"
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
                  <span className="font-mono text-muted-foreground">
                    {k.prefix}…
                  </span>
                  <span className="block text-muted-foreground">
                    Can:{" "}
                    {(k.scopes ?? [])
                      .map((s) => SCOPE_LABELS[s]?.label ?? s)
                      .join(", ")}
                    {k.expiresAt ? (
                      <>
                        {" · expires "}
                        <LocalTime iso={k.expiresAt} />
                      </>
                    ) : (
                      " · does not expire"
                    )}
                    {k.allowedCidrs && k.allowedCidrs.length > 0
                      ? ` · only from ${k.allowedCidrs.join(", ")}`
                      : ""}
                  </span>
                  <span className="block text-muted-foreground">
                    {k.lastUsedAt ? (
                      <>
                        Last used <LocalTime iso={k.lastUsedAt} />
                      </>
                    ) : (
                      "Never used"
                    )}
                  </span>
                </span>
                <ConfirmDelete
                  label={`Revoke ${k.name}`}
                  consequences="It stops working straight away. Anything using it fails until you make a new key. This cannot be undone."
                  confirmLabel="Yes, revoke it"
                  action={async () =>
                    (await revokeApiKeyAction(workspaceId, k.id)) ?? {}
                  }
                />
              </div>
              <Activity workspaceId={workspaceId} keyId={k.id} />
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-1">
        <h3 className="font-medium">Use it with an AI assistant</h3>
        <p className="text-sm text-muted-foreground">
          Assistants that connect to a web address can use this one, with the
          key as a bearer token:
        </p>
        <Textarea
          readOnly
          aria-label="Hosted MCP address"
          rows={5}
          className="font-mono text-xs"
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
        <Textarea
          readOnly
          aria-label="Example assistant settings"
          rows={9}
          className="font-mono text-xs"
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
