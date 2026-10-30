"use client";

import { useActionState, useState, useTransition } from "react";
import {
  checkTrackerAction,
  connectTrackerAction,
  disconnectAction,
  setTrackerMappingAction,
} from "@/app/(app)/w/[workspaceId]/settings/actions";
import { keepForm } from "@/lib/keep-form";
import { FormError } from "./form-message";
import { DisconnectButton } from "./disconnect-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type TrackerCatalogEntry = {
  kind: "clickup" | "asana" | "azuredevops";
  name: string;
  intro: string;
  fields: {
    name: string;
    label: string;
    help: string;
    secret: boolean;
    optional: boolean;
  }[];
};

type Status = {
  state: "connected" | "needs_reconnect";
  summary: string;
  detail: string;
  lastError: string;
};

type StatusRow = { id: string; name: string; bucket: string };

/** A connect form drawn from what the server says the tracker needs, so a new tracker needs no new screen. */
export function TrackerCard({
  workspaceId,
  entry,
  status,
  statuses,
  details,
}: {
  workspaceId: string;
  entry: TrackerCatalogEntry;
  status?: Status;
  statuses: StatusRow[];
  details?: {
    webhookUrl: string;
    closeStatusId?: string;
    reopenStatusId?: string;
  };
}) {
  const [state, action, pending] = useActionState(
    connectTrackerAction.bind(null, workspaceId, entry.kind),
    undefined,
  );
  const [mstate, maction, mpending] = useActionState(
    setTrackerMappingAction.bind(null, workspaceId, entry.kind),
    undefined,
  );
  const [close, setClose] = useState(details?.closeStatusId ?? "");
  const [reopen, setReopen] = useState(details?.reopenStatusId ?? "");
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, start] = useTransition();
  const id = (n: string) => `${entry.kind}-${n}`;
  const select = (
    n: string,
    name: string,
    label: string,
    v: string,
    set: (s: string) => void,
  ) => (
    <div>
      <Label htmlFor={id(n)} className="mb-1 block text-sm font-medium">
        {label}
      </Label>
      <Select
        name={name}
        value={v === "" ? "__none" : v}
        onValueChange={(next) => set(next === "__none" ? "" : next)}
      >
        <SelectTrigger id={id(n)}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none">Do nothing</SelectItem>
          {statuses.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
  return (
    <div className="space-y-3 rounded-xl border border-border p-3">
      <h3 className="font-medium">{entry.name} issues</h3>
      <p className="text-sm text-muted-foreground">{entry.intro}</p>
      {status ? (
        <>
          <p className="text-sm">
            <strong>{status.summary}</strong>
            {status.detail ? ` · ${status.detail}` : ""}
          </p>
          {status.state === "connected" ? (
            <p className="text-sm text-muted-foreground">Connected.</p>
          ) : (
            <p
              role="status"
              className="rounded-xl border border-destructive px-3 py-2 text-sm text-destructive"
            >
              This connection no longer works
              {status.lastError ? ` (${status.lastError})` : ""}. Connect it
              again; nothing collected so far is lost.
            </p>
          )}
          {details ? (
            <p className="text-sm text-muted-foreground">
              Notifications go to{" "}
              <code className="break-all">{details.webhookUrl}</code>
            </p>
          ) : null}
          <form
            method="post"
            onSubmit={keepForm(maction)}
            className="space-y-2"
          >
            <p className="text-sm font-medium">When an issue changes</p>
            <div className="flex flex-wrap gap-4">
              {select(
                "close",
                "close",
                "Done: move the request to",
                close,
                setClose,
              )}
              {select(
                "reopen",
                "reopen",
                "Reopened: move the request to",
                reopen,
                setReopen,
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Moving a request to a shipped status prepares message drafts for
              you to review. Nothing is sent without your approval. If someone
              moved the request here in the meantime, it is left alone and the
              difference is shown on the request.
            </p>
            <FormError message={mstate?.error} />
            <Button type="submit" variant="outline" disabled={mpending}>
              Save
            </Button>
          </form>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() =>
                start(async () => {
                  const r = await checkTrackerAction(workspaceId, entry.kind);
                  setError(r.error);
                  setNotice(
                    r.ok ? `${entry.name} accepts the connection.` : undefined,
                  );
                })
              }
            >
              Check connection
            </Button>
            <DisconnectButton
              what={entry.name}
              disabled={busy}
              onConfirm={() => disconnectAction(workspaceId, entry.kind)}
            />
          </div>
        </>
      ) : null}
      <form method="post" onSubmit={keepForm(action)} className="space-y-3">
        <p className="text-sm font-medium">
          {status ? "Connect again with different details" : "Connect"}
        </p>
        {entry.fields.map((f) => (
          <div key={f.name}>
            <Label
              htmlFor={id(f.name)}
              className="mb-1 block text-sm font-medium"
            >
              {f.label}
              {f.optional ? " (optional)" : ""}
            </Label>
            <Input
              id={id(f.name)}
              name={f.name}
              type={f.secret ? "password" : "text"}
              autoComplete="off"
              className="max-w-sm"
              aria-describedby={f.help ? id(f.name + "-help") : undefined}
            />
            {f.help ? (
              <p
                id={id(f.name + "-help")}
                className="mt-1 text-sm text-muted-foreground"
              >
                {f.help}
              </p>
            ) : null}
          </div>
        ))}
        <div className="flex flex-wrap gap-4">
          {select(
            "close-new",
            "close",
            "Done: move the request to",
            close,
            setClose,
          )}
          {select(
            "reopen-new",
            "reopen",
            "Reopened: move the request to",
            reopen,
            setReopen,
          )}
        </div>
        <FormError message={state?.error} />
        <Button type="submit" disabled={pending}>
          Connect
        </Button>
      </form>
      {state?.show && state.show.length > 0 ? (
        <div
          role="status"
          className="space-y-2 rounded-xl border border-border p-3"
        >
          {state.note ? (
            <p className="text-sm font-medium">{state.note}</p>
          ) : null}
          {state.show.map((s, i) => (
            <div key={i}>
              <Label htmlFor={id(`shown-${i}`)} className="block text-sm">
                {s.label}
                {s.secret ? " (shown only now)" : ""}
              </Label>
              <Input
                id={id(`shown-${i}`)}
                readOnly
                value={s.value}
                className="font-mono text-sm"
              />
            </div>
          ))}
        </div>
      ) : state?.note ? (
        <p role="status" className="text-sm text-muted-foreground">
          {state.note}
        </p>
      ) : null}
      <FormError message={error} />
      {notice ? (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
