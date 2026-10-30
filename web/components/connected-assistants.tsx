"use client";

import { disconnectAssistantAction } from "@/app/(app)/w/[workspaceId]/settings/actions";
import { DisconnectButton } from "./disconnect-button";
import { SCOPE_TEXT } from "@/lib/scopes";
import { Input } from "@/components/ui/input";
import { LocalTime } from "./local-time";

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

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <h3 className="font-medium">Connected assistants</h3>
      <p className="text-sm text-muted-foreground">
        Assistants that support signing in only need this address. You approve
        them once; their access renews itself until you disconnect them.
      </p>
      <Input
        readOnly
        aria-label="Address to give an assistant that signs in"
        className="font-mono text-sm"
        value={`${apiUrl}/mcp`}
      />
      {grants.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No assistant has signed in yet.
        </p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {grants.map((g) => (
            <li
              key={g.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3"
            >
              <span>
                <strong>{g.clientName}</strong>
                <span className="block text-muted-foreground">
                  Can:{" "}
                  {g.scopes.map((s) => SCOPE_TEXT[s]?.label ?? s).join(", ")}
                </span>
                <span className="block text-muted-foreground">
                  Connected <LocalTime iso={g.createdAt} /> ·{" "}
                  {g.lastUsedAt ? (
                    <>
                      last used <LocalTime iso={g.lastUsedAt} />
                    </>
                  ) : (
                    "never used"
                  )}
                </span>
              </span>
              <DisconnectButton
                what={g.clientName}
                onConfirm={() =>
                  disconnectAssistantAction(workspaceId, g.id)
                }
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
