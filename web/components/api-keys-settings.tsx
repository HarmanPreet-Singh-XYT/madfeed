"use client";

import { useActionState, useState, useTransition } from "react";
import {
  createApiKeyAction,
  revokeApiKeyAction,
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
  revoked: boolean;
};

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
  const [error, setError] = useState<string>();
  const [revoking, startRevoke] = useTransition();
  const active = keys.filter((k) => !k.revoked);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        A read-only key lets a script or an AI assistant (through the MCP
        server) look up your requests, the customer quotes behind them, and ask
        questions that are answered only from those quotes. It can change
        nothing, and it never shows names or email addresses.
      </p>
      <form
        method="post"
        onSubmit={keepForm(action)}
        className="flex flex-wrap items-end gap-3"
      >
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
          <p className="text-sm text-muted">
            Keep it secret. Anyone who has it can read this workspace&apos;s
            requests and quotes until you revoke it.
          </p>
        </div>
      ) : null}
      {active.length === 0 ? (
        <p className="text-sm text-muted">No active keys.</p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {active.map((k) => (
            <li
              key={k.id}
              className="flex flex-wrap items-center justify-between gap-3 py-2"
            >
              <span>
                <strong>{k.name}</strong>{" "}
                <span className="font-mono text-muted">{k.prefix}…</span>
                <span className="block text-muted">
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
            </li>
          ))}
        </ul>
      )}
      <FormError message={error} />
      <div className="space-y-1">
        <h3 className="font-medium">Use it with an AI assistant</h3>
        <p className="text-sm text-muted">
          Build the MCP server once (
          <code>go build -o feedback-mcp ./cmd/mcp</code> in the api folder),
          then add it to your assistant&apos;s settings:
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
        <p className="text-sm text-muted">
          Customer quotes are untrusted text written by customers. Assistants
          are told to treat them as evidence, not instructions.
        </p>
      </div>
    </div>
  );
}
