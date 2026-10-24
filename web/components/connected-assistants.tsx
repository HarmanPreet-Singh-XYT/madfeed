"use client";

import { useState, useTransition } from "react";
import { disconnectAssistantAction } from "@/app/(app)/w/[workspaceId]/settings/actions";
import { FormError } from "./form-message";
import { SCOPE_TEXT } from "@/lib/scopes";
import { btn, field } from "./ui";

type Grant = {
  id: string;
  clientName: string;
  createdAt: string;
  lastUsedAt?: string;
  scopes: string[];
};

/** Assistants that signed in through the approval page, with a way to cut each one off at once. */
export function ConnectedAssistants({
  workspaceId,
  grants,
  apiUrl,
}: {
  workspaceId: string;
  grants: Grant[];
  apiUrl: string;
}) {
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3 border-t border-border pt-4">
      <h3 className="font-medium">Connected assistants</h3>
      <p className="text-sm text-muted">
        Assistants that support signing in only need this address. You approve
        them once; their access renews itself until you disconnect them.
      </p>
      <input
        readOnly
        aria-label="Address to give an assistant that signs in"
        className={`${field} font-mono text-sm`}
        value={`${apiUrl}/mcp`}
      />
      {grants.length === 0 ? (
        <p className="text-sm text-muted">No assistant has signed in yet.</p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {grants.map((g) => (
            <li
              key={g.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3"
            >
              <span>
                <strong>{g.clientName}</strong>
                <span className="block text-muted">
                  Can:{" "}
                  {g.scopes.map((s) => SCOPE_TEXT[s]?.label ?? s).join(", ")}
                </span>
                <span className="block text-muted">
                  Connected {new Date(g.createdAt).toLocaleDateString()} ·{" "}
                  {g.lastUsedAt
                    ? `last used ${new Date(g.lastUsedAt).toLocaleDateString()}`
                    : "never used"}
                </span>
              </span>
              <button
                type="button"
                className={btn}
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await disconnectAssistantAction(
                      workspaceId,
                      g.id,
                    );
                    setError(r?.error);
                  })
                }
              >
                Disconnect
                <span className="sr-only"> {g.clientName}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <FormError message={error} />
    </div>
  );
}
