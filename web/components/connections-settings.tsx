"use client";

import { useActionState, useState, useTransition } from "react";
import {
  checkConnectionAction,
  connectGithubAction,
  connectHubspotAction,
  connectSalesforceAction,
  connectJiraAction,
  connectLinearAction,
  disconnectAction,
  setGithubMappingAction,
  setJiraMappingAction,
  syncHubspotAction,
  syncSalesforceAction,
  setLinearMappingAction,
  setLinearSecretAction,
  setSlackChannelAction,
  slackChannelsAction,
  startSlackAction,
} from "@/app/(app)/w/[workspaceId]/settings/actions";
import { keepForm } from "@/lib/keep-form";
import { FormError } from "./form-message";
import { btn, btnPrimary, field } from "./ui";
import { TrackerCard, type TrackerCatalogEntry } from "./tracker-card";
import { LocalTime } from "./local-time";

type Status = {
  kind:
    | "slack"
    | "github"
    | "linear"
    | "jira"
    | "hubspot"
    | "clickup"
    | "asana"
    | "azuredevops"
    | "salesforce";
  state: "connected" | "needs_reconnect";
  summary: string;
  detail: string;
  lastError: string;
};
type StatusRow = { id: string; name: string; bucket: string };

function StateNote({ s }: { s: Status }) {
  return s.state === "connected" ? (
    <p className="text-sm text-muted-foreground">Connected.</p>
  ) : (
    <p
      role="status"
      className="rounded-md border border-destructive px-3 py-2 text-sm text-destructive"
    >
      This connection no longer works
      {s.lastError ? ` (${s.lastError})` : ""}. Connect it again; nothing
      collected so far is lost.
    </p>
  );
}

function SlackCard({
  workspaceId,
  status,
  available,
}: {
  workspaceId: string;
  status?: Status;
  available: boolean;
}) {
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [channels, setChannels] = useState<{ id: string; name: string }[]>();
  const [chosen, setChosen] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <h3 className="font-medium">Slack</h3>
      <p className="text-sm text-muted-foreground">
        Messages in one channel you choose become feedback in your review queue.
        A person still decides what becomes a request.
      </p>
      {!available ? (
        <p className="text-sm text-muted-foreground">
          Slack isn&apos;t set up on this server yet.
        </p>
      ) : (
        <>
          {status ? (
            <>
              <p className="text-sm">
                <strong>{status.summary}</strong>
                {status.detail
                  ? ` · collecting from ${status.detail}`
                  : " · no channel chosen yet"}
              </p>
              <StateNote s={status} />
            </>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className={status?.state === "connected" ? btn : btnPrimary}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await startSlackAction(workspaceId);
                  setError(r?.error);
                })
              }
            >
              {status ? "Connect again" : "Add to Slack"}
            </button>
            {status ? (
              <>
                <button
                  type="button"
                  className={btn}
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await slackChannelsAction(workspaceId);
                      setError(r.error);
                      setNotice(undefined);
                      setChannels(r.channels);
                    })
                  }
                >
                  Choose channel
                </button>
                <button
                  type="button"
                  className={btn}
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await checkConnectionAction(
                        workspaceId,
                        "slack",
                      );
                      setError(r.error);
                      setNotice(
                        r.ok ? "Slack accepts the connection." : undefined,
                      );
                    })
                  }
                >
                  Check connection
                </button>
                <button
                  type="button"
                  className={btn}
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await disconnectAction(workspaceId, "slack");
                      setError(r.error);
                    })
                  }
                >
                  Disconnect
                </button>
              </>
            ) : null}
          </div>
          {channels ? (
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label
                  htmlFor="slack-channel"
                  className="mb-1 block text-sm font-medium"
                >
                  Collect feedback from
                </label>
                <select
                  id="slack-channel"
                  value={chosen}
                  onChange={(e) => setChosen(e.target.value)}
                  className={field}
                >
                  <option value="">Choose a channel…</option>
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      #{c.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                className={btnPrimary}
                disabled={pending || !chosen}
                onClick={() =>
                  start(async () => {
                    const r = await setSlackChannelAction(workspaceId, chosen);
                    setError(r.error);
                    if (!r.error) {
                      setChannels(undefined);
                      setNotice("Saved. The app has joined the channel.");
                    }
                  })
                }
              >
                Use this channel
              </button>
            </div>
          ) : null}
        </>
      )}
      <FormError message={error} />
      {notice ? (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}
    </div>
  );
}

function GithubCard({
  workspaceId,
  status,
  statuses,
  mapping,
  webhookUrl,
}: {
  workspaceId: string;
  status?: Status;
  statuses: StatusRow[];
  mapping: { close?: string; reopen?: string };
  webhookUrl?: string;
}) {
  const [state, action, pending] = useActionState(
    connectGithubAction.bind(null, workspaceId),
    undefined,
  );
  const [mstate, maction, mpending] = useActionState(
    setGithubMappingAction.bind(null, workspaceId),
    undefined,
  );
  const [token, setToken] = useState("");
  const [repo, setRepo] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [close, setClose] = useState(mapping.close ?? "");
  const [reopen, setReopen] = useState(mapping.reopen ?? "");
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, start] = useTransition();
  const select = (
    id: string,
    label: string,
    v: string,
    set: (s: string) => void,
  ) => (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <select
        id={id}
        name={id === "gh-close" ? "close" : "reopen"}
        value={v}
        onChange={(e) => set(e.target.value)}
        className={field}
      >
        <option value="">Do nothing</option>
        {statuses.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </div>
  );
  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <h3 className="font-medium">GitHub issues</h3>
      <p className="text-sm text-muted-foreground">
        Open an issue for a request from its page. When the issue is closed or
        reopened, the request can follow. Issues carry only the request&apos;s
        title and counts, never customer quotes, names or emails.
      </p>
      {status ? (
        <>
          <p className="text-sm">
            <strong>{status.summary}</strong>
          </p>
          <StateNote s={status} />
          {webhookUrl ? (
            <p className="text-sm text-muted-foreground">
              Notifications go to{" "}
              <code className="break-all">{webhookUrl}</code>
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
                "gh-close",
                "Closed: move the request to",
                close,
                setClose,
              )}
              {select(
                "gh-reopen",
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
            <button type="submit" className={btn} disabled={mpending}>
              Save
            </button>
          </form>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className={btn}
              disabled={busy}
              onClick={() =>
                start(async () => {
                  const r = await checkConnectionAction(workspaceId, "github");
                  setError(r.error);
                  setNotice(
                    r.ok ? "GitHub accepts the connection." : undefined,
                  );
                })
              }
            >
              Check connection
            </button>
            <button
              type="button"
              className={btn}
              disabled={busy}
              onClick={() =>
                start(async () => {
                  const r = await disconnectAction(workspaceId, "github");
                  setError(r.error);
                })
              }
            >
              Disconnect
            </button>
          </div>
        </>
      ) : null}
      <form method="post" onSubmit={keepForm(action)} className="space-y-3">
        <p className="text-sm font-medium">
          {status
            ? "Connect a different repository or token"
            : "Connect a repository"}
        </p>
        <div>
          <label htmlFor="gh-repo" className="mb-1 block text-sm font-medium">
            Repository (owner/name)
          </label>
          <input
            id="gh-repo"
            name="repo"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            className={`${field} max-w-sm`}
          />
        </div>
        <div>
          <label htmlFor="gh-token" className="mb-1 block text-sm font-medium">
            Access token
          </label>
          <input
            id="gh-token"
            name="token"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className={`${field} max-w-sm`}
            aria-describedby="gh-token-help"
          />
          <p id="gh-token-help" className="mt-1 text-sm text-muted-foreground">
            Make one in GitHub for this repository only, with permission to read
            and write issues. It is stored encrypted and never shown again.
          </p>
        </div>
        <div className="flex flex-wrap gap-4">
          {select("gh-close", "Closed: move the request to", close, setClose)}
          {select(
            "gh-reopen",
            "Reopened: move the request to",
            reopen,
            setReopen,
          )}
        </div>
        <div className="flex items-start gap-3">
          <input
            id="gh-public"
            name="public"
            type="checkbox"
            className="mt-0.5 size-5"
            checked={isPublic}
            onChange={(e) => setIsPublic(e.target.checked)}
          />
          <label htmlFor="gh-public" className="text-sm">
            The repository is public, and I know issue titles will be public
            (needed only for a public repository).
          </label>
        </div>
        <FormError message={state?.error} />
        <button type="submit" className={btnPrimary} disabled={pending}>
          Connect
        </button>
      </form>
      {state?.webhookSecret ? (
        <div
          role="status"
          className="space-y-2 rounded-md border border-border p-3"
        >
          <p className="text-sm font-medium">
            One more step, in the repository&apos;s webhook settings: copy these
            now, the secret is shown only once.
          </p>
          <label htmlFor="gh-hook-url" className="block text-sm">
            Payload URL
          </label>
          <input
            id="gh-hook-url"
            readOnly
            value={state.webhookUrl}
            className={`${field} font-mono text-sm`}
          />
          <label htmlFor="gh-hook-secret" className="block text-sm">
            Secret
          </label>
          <input
            id="gh-hook-secret"
            readOnly
            value={state.webhookSecret}
            className={`${field} font-mono text-sm`}
          />
          <p className="text-sm text-muted-foreground">
            Content type: application/json. Events: choose &quot;Issues&quot;
            only.
          </p>
        </div>
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

function LinearCard({
  workspaceId,
  status,
  statuses,
  details,
}: {
  workspaceId: string;
  status?: Status;
  statuses: StatusRow[];
  details?: {
    webhookUrl: string;
    hasSecret: boolean;
    closeStatusId?: string;
    reopenStatusId?: string;
  };
}) {
  const [state, action, pending] = useActionState(
    connectLinearAction.bind(null, workspaceId),
    undefined,
  );
  const [mstate, maction, mpending] = useActionState(
    setLinearMappingAction.bind(null, workspaceId),
    undefined,
  );
  const [sstate, saction, spending] = useActionState(
    setLinearSecretAction.bind(null, workspaceId),
    undefined,
  );
  const [close, setClose] = useState(details?.closeStatusId ?? "");
  const [reopen, setReopen] = useState(details?.reopenStatusId ?? "");
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, start] = useTransition();
  const select = (
    id: string,
    name: string,
    label: string,
    v: string,
    set: (s: string) => void,
  ) => (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <select
        id={id}
        name={name}
        value={v}
        onChange={(e) => set(e.target.value)}
        className={field}
      >
        <option value="">Do nothing</option>
        {statuses.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </div>
  );
  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <h3 className="font-medium">Linear issues</h3>
      <p className="text-sm text-muted-foreground">
        Open an issue for a request from its page. When the issue is completed,
        canceled or reopened, the request can follow. Issues carry only the
        request&apos;s title and counts, never customer quotes, names or emails.
      </p>
      {status ? (
        <>
          <p className="text-sm">
            <strong>{status.summary}</strong>
            {status.detail ? ` · ${status.detail}` : ""}
          </p>
          <StateNote s={status} />
          {details && !details.hasSecret ? (
            <p role="status" className="text-sm">
              Changes made in Linear are not followed yet. In Linear, make a
              webhook for the Issue resource that sends to{" "}
              <code className="break-all">{details.webhookUrl}</code>, then
              paste the signing secret Linear shows below.
            </p>
          ) : null}
          <form
            method="post"
            onSubmit={keepForm(saction)}
            className="flex flex-wrap items-end gap-3"
          >
            <div>
              <label
                htmlFor="lin-secret"
                className="mb-1 block text-sm font-medium"
              >
                {details?.hasSecret
                  ? "Replace the webhook's signing secret"
                  : "Webhook signing secret"}
              </label>
              <input
                id="lin-secret"
                name="secret"
                type="password"
                autoComplete="off"
                className={`${field} max-w-sm`}
              />
            </div>
            <button type="submit" className={btn} disabled={spending}>
              Save the secret
            </button>
          </form>
          <FormError message={sstate?.error} />
          {sstate?.saved ? (
            <p role="status" className="text-sm text-muted-foreground">
              Saved. Changes made in Linear are followed from now on.
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
                "lin-close",
                "close",
                "Completed or canceled: move the request to",
                close,
                setClose,
              )}
              {select(
                "lin-reopen",
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
            <button type="submit" className={btn} disabled={mpending}>
              Save
            </button>
          </form>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className={btn}
              disabled={busy}
              onClick={() =>
                start(async () => {
                  const r = await checkConnectionAction(workspaceId, "linear");
                  setError(r.error);
                  setNotice(
                    r.ok ? "Linear accepts the connection." : undefined,
                  );
                })
              }
            >
              Check connection
            </button>
            <button
              type="button"
              className={btn}
              disabled={busy}
              onClick={() =>
                start(async () => {
                  const r = await disconnectAction(workspaceId, "linear");
                  setError(r.error);
                })
              }
            >
              Disconnect
            </button>
          </div>
        </>
      ) : null}
      <form method="post" onSubmit={keepForm(action)} className="space-y-3">
        <p className="text-sm font-medium">
          {status ? "Connect a different team or key" : "Connect a team"}
        </p>
        <div>
          <label htmlFor="lin-team" className="mb-1 block text-sm font-medium">
            Team key (the prefix of its issues, for example ENG)
          </label>
          <input
            id="lin-team"
            name="teamKey"
            maxLength={10}
            className={`${field} max-w-xs`}
          />
        </div>
        <div>
          <label htmlFor="lin-token" className="mb-1 block text-sm font-medium">
            Personal API key
          </label>
          <input
            id="lin-token"
            name="token"
            type="password"
            autoComplete="off"
            className={`${field} max-w-sm`}
            aria-describedby="lin-token-help"
          />
          <p id="lin-token-help" className="mt-1 text-sm text-muted-foreground">
            Make one in Linear under your account&apos;s API settings. It acts
            as you, so use an account that can create issues in that team. It is
            stored encrypted and never shown again.
          </p>
        </div>
        <div className="flex flex-wrap gap-4">
          {select(
            "lin-close-new",
            "close",
            "Completed or canceled: move the request to",
            close,
            setClose,
          )}
          {select(
            "lin-reopen-new",
            "reopen",
            "Reopened: move the request to",
            reopen,
            setReopen,
          )}
        </div>
        <FormError message={state?.error} />
        <button type="submit" className={btnPrimary} disabled={pending}>
          Connect
        </button>
      </form>
      {state?.webhookUrl ? (
        <div
          role="status"
          className="space-y-2 rounded-md border border-border p-3"
        >
          <p className="text-sm font-medium">
            One more step, in Linear: make a webhook for the Issue resource.
          </p>
          <label htmlFor="lin-hook-url" className="block text-sm">
            URL
          </label>
          <input
            id="lin-hook-url"
            readOnly
            value={state.webhookUrl}
            className={`${field} font-mono text-sm`}
          />
          <p className="text-sm text-muted-foreground">
            Linear then shows a signing secret. Paste it into the box above so
            changes made in Linear can be checked and followed.
          </p>
        </div>
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

function JiraCard({
  workspaceId,
  status,
  statuses,
  details,
}: {
  workspaceId: string;
  status?: Status;
  statuses: StatusRow[];
  details?: {
    webhookUrl: string;
    closeStatusId?: string;
    reopenStatusId?: string;
  };
}) {
  const [state, action, pending] = useActionState(
    connectJiraAction.bind(null, workspaceId),
    undefined,
  );
  const [mstate, maction, mpending] = useActionState(
    setJiraMappingAction.bind(null, workspaceId),
    undefined,
  );
  const [close, setClose] = useState(details?.closeStatusId ?? "");
  const [reopen, setReopen] = useState(details?.reopenStatusId ?? "");
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, start] = useTransition();
  const select = (
    id: string,
    name: string,
    label: string,
    v: string,
    set: (s: string) => void,
  ) => (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <select
        id={id}
        name={name}
        value={v}
        onChange={(e) => set(e.target.value)}
        className={field}
      >
        <option value="">Do nothing</option>
        {statuses.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </div>
  );
  const text = (id: string, name: string, label: string, extra = {}) => (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <input id={id} name={name} className={`${field} max-w-sm`} {...extra} />
    </div>
  );
  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <h3 className="font-medium">Jira issues</h3>
      <p className="text-sm text-muted-foreground">
        Open an issue for a request from its page. When the issue is done or
        reopened, the request can follow. Issues carry only the request&apos;s
        title and counts, never customer quotes, names or emails. Jira Cloud
        only.
      </p>
      {status ? (
        <>
          <p className="text-sm">
            <strong>{status.summary}</strong>
            {status.detail ? ` · ${status.detail}` : ""}
          </p>
          <StateNote s={status} />
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
                "jira-close",
                "close",
                "Done: move the request to",
                close,
                setClose,
              )}
              {select(
                "jira-reopen",
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
            <button type="submit" className={btn} disabled={mpending}>
              Save
            </button>
          </form>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className={btn}
              disabled={busy}
              onClick={() =>
                start(async () => {
                  const r = await checkConnectionAction(workspaceId, "jira");
                  setError(r.error);
                  setNotice(r.ok ? "Jira accepts the connection." : undefined);
                })
              }
            >
              Check connection
            </button>
            <button
              type="button"
              className={btn}
              disabled={busy}
              onClick={() =>
                start(async () => {
                  const r = await disconnectAction(workspaceId, "jira");
                  setError(r.error);
                })
              }
            >
              Disconnect
            </button>
          </div>
        </>
      ) : null}
      <form method="post" onSubmit={keepForm(action)} className="space-y-3">
        <p className="text-sm font-medium">
          {status
            ? "Connect a different project or token"
            : "Connect a project"}
        </p>
        {text("jira-site", "site", "Jira site (acme for acme.atlassian.net)")}
        {text(
          "jira-project",
          "project",
          "Project key (the prefix of its issues, for example PROJ)",
          { maxLength: 20 },
        )}
        {text(
          "jira-type",
          "issueType",
          "Issue type (optional, Task if left empty)",
          { maxLength: 60 },
        )}
        {text("jira-email", "email", "Atlassian account email", {
          type: "email",
          autoComplete: "off",
        })}
        <div>
          <label
            htmlFor="jira-token"
            className="mb-1 block text-sm font-medium"
          >
            API token
          </label>
          <input
            id="jira-token"
            name="token"
            type="password"
            autoComplete="off"
            className={`${field} max-w-sm`}
            aria-describedby="jira-token-help"
          />
          <p
            id="jira-token-help"
            className="mt-1 text-sm text-muted-foreground"
          >
            Make one in your Atlassian account&apos;s security settings. It acts
            as that account, so use one that can create issues in the project (a
            shared account made for this is best). It is stored encrypted and
            never shown again.
          </p>
        </div>
        <div className="flex flex-wrap gap-4">
          {select(
            "jira-close-new",
            "close",
            "Done: move the request to",
            close,
            setClose,
          )}
          {select(
            "jira-reopen-new",
            "reopen",
            "Reopened: move the request to",
            reopen,
            setReopen,
          )}
        </div>
        <FormError message={state?.error} />
        <button type="submit" className={btnPrimary} disabled={pending}>
          Connect
        </button>
      </form>
      {state?.webhookSecret ? (
        <div
          role="status"
          className="space-y-2 rounded-md border border-border p-3"
        >
          <p className="text-sm font-medium">
            One more step, in Jira (Settings, System, Webhooks): make a webhook
            with these. Copy them now, the secret is shown only once.
          </p>
          <label htmlFor="jira-hook-url" className="block text-sm">
            URL
          </label>
          <input
            id="jira-hook-url"
            readOnly
            value={state.webhookUrl}
            className={`${field} font-mono text-sm`}
          />
          <label htmlFor="jira-hook-secret" className="block text-sm">
            Secret
          </label>
          <input
            id="jira-hook-secret"
            readOnly
            value={state.webhookSecret}
            className={`${field} font-mono text-sm`}
          />
          <p className="text-sm text-muted-foreground">
            Events: issue updated and issue deleted. Limit it to this project if
            Jira offers that.
          </p>
        </div>
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

type HubspotDetails = {
  valueFrom: "revenue" | "won_deals";
  syncing: boolean;
  lastSync?: {
    at: string;
    ok: boolean;
    error?: string;
    people: number;
    matched: number;
    peopleLinked: number;
    accountsCreated: number;
    accountsUpdated: number;
    skipped: number;
  };
};

function HubspotCard({
  workspaceId,
  status,
  details,
}: {
  workspaceId: string;
  status?: Status;
  details?: HubspotDetails;
}) {
  const [state, action, pending] = useActionState(
    connectHubspotAction.bind(null, workspaceId),
    undefined,
  );
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, start] = useTransition();
  const last = details?.lastSync;
  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <h3 className="font-medium">HubSpot: account value</h3>
      <p className="text-sm text-muted-foreground">
        Fills in each account&apos;s value from HubSpot, so requests are
        weighted by what the customers asking are worth. It looks up people you
        already have by email, never creates or removes anyone, and never
        changes anything in HubSpot. A person&apos;s existing account is only
        updated when it is the same company.
      </p>
      {status ? (
        <>
          <p className="text-sm">
            <strong>{status.summary}</strong>
            {status.detail ? ` · ${status.detail}` : ""}
          </p>
          <StateNote s={status} />
          {details?.syncing ? (
            <p role="status" className="text-sm text-muted-foreground">
              A sync is waiting to run; it starts within a minute. Reload to see
              the result.
            </p>
          ) : null}
          {last ? (
            <p className="text-sm" role="status">
              {last.ok ? "Last synced" : "Last attempt failed"}{" "}
              <LocalTime iso={last.at} time />
              {last.ok
                ? `: ${last.matched} of ${last.people} people found in HubSpot, ${last.peopleLinked} given an account, ${last.accountsCreated} accounts added, ${last.accountsUpdated} updated${last.skipped > 0 ? `, ${last.skipped} left alone because their account is a different company` : ""}.`
                : ` (${last.error ?? "unknown reason"}).`}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className={btn}
              disabled={busy || details?.syncing}
              onClick={() =>
                start(async () => {
                  const r = await syncHubspotAction(workspaceId);
                  setError(r?.error);
                  setNotice(
                    r?.error ? undefined : "A sync will start within a minute.",
                  );
                })
              }
            >
              Sync now
            </button>
            <button
              type="button"
              className={btn}
              disabled={busy}
              onClick={() =>
                start(async () => {
                  const r = await disconnectAction(workspaceId, "hubspot");
                  setError(r.error);
                })
              }
            >
              Disconnect
            </button>
          </div>
        </>
      ) : null}
      <form method="post" onSubmit={keepForm(action)} className="space-y-3">
        <p className="text-sm font-medium">
          {status ? "Connect with a different token or value" : "Connect"}
        </p>
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">
            A company&apos;s value is
          </legend>
          <div className="flex items-start gap-3">
            <input
              id="hs-revenue"
              type="radio"
              name="valueFrom"
              value="revenue"
              defaultChecked={details?.valueFrom !== "won_deals"}
              className="mt-0.5 size-5"
            />
            <label htmlFor="hs-revenue" className="text-sm">
              its annual revenue in HubSpot
            </label>
          </div>
          <div className="flex items-start gap-3">
            <input
              id="hs-deals"
              type="radio"
              name="valueFrom"
              value="won_deals"
              defaultChecked={details?.valueFrom === "won_deals"}
              className="mt-0.5 size-5"
            />
            <label htmlFor="hs-deals" className="text-sm">
              the total of its closed-won deals
            </label>
          </div>
        </fieldset>
        <div>
          <label htmlFor="hs-token" className="mb-1 block text-sm font-medium">
            Private app access token
          </label>
          <input
            id="hs-token"
            name="token"
            type="password"
            autoComplete="off"
            className={`${field} max-w-sm`}
            aria-describedby="hs-token-help"
          />
          <p id="hs-token-help" className="mt-1 text-sm text-muted-foreground">
            In HubSpot, make a private app with read access to contacts and
            companies (and deals if you chose deals) and nothing else. The token
            is stored encrypted and never shown again.
          </p>
        </div>
        <FormError message={state?.error} />
        <button type="submit" className={btnPrimary} disabled={pending}>
          Connect
        </button>
      </form>
      <FormError message={error} />
      {notice ? (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}
    </div>
  );
}

type SalesforceDetails = {
  valueFrom: "revenue" | "won_deals";
  syncing: boolean;
  lastSync?: {
    at: string;
    ok: boolean;
    error?: string;
    people: number;
    matched: number;
    peopleLinked: number;
    accountsCreated: number;
    accountsUpdated: number;
    skipped: number;
  };
};

function SalesforceCard({
  workspaceId,
  status,
  details,
}: {
  workspaceId: string;
  status?: Status;
  details?: SalesforceDetails;
}) {
  const [state, action, pending] = useActionState(
    connectSalesforceAction.bind(null, workspaceId),
    undefined,
  );
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, start] = useTransition();
  const last = details?.lastSync;
  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <h3 className="font-medium">Salesforce: account value</h3>
      <p className="text-sm text-muted-foreground">
        Fills in each account&apos;s value from Salesforce, so requests are
        weighted by what the customers asking are worth. It looks up people you
        already have by email, never creates or removes anyone, and never
        changes anything in Salesforce. A person&apos;s existing account is only
        updated when it is the same company.
      </p>
      {status ? (
        <>
          <p className="text-sm">
            <strong>{status.summary}</strong>
            {status.detail ? ` · ${status.detail}` : ""}
          </p>
          <StateNote s={status} />
          {details?.syncing ? (
            <p role="status" className="text-sm text-muted-foreground">
              A sync is waiting to run; it starts within a minute. Reload to see
              the result.
            </p>
          ) : null}
          {last ? (
            <p className="text-sm" role="status">
              {last.ok ? "Last synced" : "Last attempt failed"}{" "}
              <LocalTime iso={last.at} time />
              {last.ok
                ? `: ${last.matched} of ${last.people} people found in Salesforce, ${last.peopleLinked} given an account, ${last.accountsCreated} accounts added, ${last.accountsUpdated} updated${last.skipped > 0 ? `, ${last.skipped} left alone because their account is a different company` : ""}.`
                : ` (${last.error ?? "unknown reason"}).`}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className={btn}
              disabled={busy || details?.syncing}
              onClick={() =>
                start(async () => {
                  const r = await syncSalesforceAction(workspaceId);
                  setError(r?.error);
                  setNotice(
                    r?.error ? undefined : "A sync will start within a minute.",
                  );
                })
              }
            >
              Sync now
            </button>
            <button
              type="button"
              className={btn}
              disabled={busy}
              onClick={() =>
                start(async () => {
                  const r = await disconnectAction(workspaceId, "salesforce");
                  setError(r.error);
                })
              }
            >
              Disconnect
            </button>
          </div>
        </>
      ) : null}
      <form method="post" onSubmit={keepForm(action)} className="space-y-3">
        <p className="text-sm font-medium">
          {status ? "Connect with a different token or value" : "Connect"}
        </p>
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">
            A company&apos;s value is
          </legend>
          <div className="flex items-start gap-3">
            <input
              id="sf-revenue"
              type="radio"
              name="valueFrom"
              value="revenue"
              defaultChecked={details?.valueFrom !== "won_deals"}
              className="mt-0.5 size-5"
            />
            <label htmlFor="sf-revenue" className="text-sm">
              its annual revenue in Salesforce
            </label>
          </div>
          <div className="flex items-start gap-3">
            <input
              id="sf-deals"
              type="radio"
              name="valueFrom"
              value="won_deals"
              defaultChecked={details?.valueFrom === "won_deals"}
              className="mt-0.5 size-5"
            />
            <label htmlFor="sf-deals" className="text-sm">
              the total of its closed-won deals
            </label>
          </div>
        </fieldset>
        <div>
          <label
            htmlFor="sf-instance"
            className="mb-1 block text-sm font-medium"
          >
            My Domain address
          </label>
          <input
            id="sf-instance"
            name="instanceUrl"
            placeholder="https://acme.my.salesforce.com"
            autoComplete="off"
            className={`${field} max-w-sm`}
          />
        </div>
        <div>
          <label
            htmlFor="sf-client-id"
            className="mb-1 block text-sm font-medium"
          >
            Consumer key
          </label>
          <input
            id="sf-client-id"
            name="clientId"
            autoComplete="off"
            className={`${field} max-w-sm`}
          />
        </div>
        <div>
          <label htmlFor="sf-token" className="mb-1 block text-sm font-medium">
            Consumer secret
          </label>
          <input
            id="sf-token"
            name="clientSecret"
            type="password"
            autoComplete="off"
            className={`${field} max-w-sm`}
            aria-describedby="sf-token-help"
          />
          <p id="sf-token-help" className="mt-1 text-sm text-muted-foreground">
            In Salesforce, make a connected app with the client credentials flow
            switched on, run as a user with read access to contacts, accounts
            and opportunities. The secret is stored encrypted and never shown
            again.
          </p>
        </div>
        <FormError message={state?.error} />
        <button type="submit" className={btnPrimary} disabled={pending}>
          Connect
        </button>
      </form>
      <FormError message={error} />
      {notice ? (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}
    </div>
  );
}

export function ConnectionsSettings({
  workspaceId,
  statuses,
  slackAvailable,
  githubAvailable,
  integrations,
  github,
  linear,
  jira,
  hubspot,
  salesforce,
  enabledKinds,
  trackers,
  trackerDetails,
  workflow,
}: {
  workspaceId: string;
  statuses: StatusRow[];
  slackAvailable: boolean;
  githubAvailable: boolean;
  integrations: Status[];
  github?: {
    webhookUrl: string;
    closeStatusId?: string;
    reopenStatusId?: string;
  };
  linear?: {
    webhookUrl: string;
    hasSecret: boolean;
    closeStatusId?: string;
    reopenStatusId?: string;
  };
  jira?: {
    webhookUrl: string;
    closeStatusId?: string;
    reopenStatusId?: string;
  };
  hubspot?: HubspotDetails;
  salesforce?: SalesforceDetails;
  /** The services this server has switched on; the others are not offered. */
  enabledKinds: string[];
  /** The driver-based trackers on offer (ClickUp, Asana, Azure DevOps) and the details of any that are connected. */
  trackers: TrackerCatalogEntry[];
  trackerDetails: Record<
    string,
    { webhookUrl: string; closeStatusId?: string; reopenStatusId?: string }
  >;
  workflow?: never;
}) {
  void workflow;
  const slack = integrations.find((i) => i.kind === "slack");
  const gh = integrations.find((i) => i.kind === "github");
  const lin = integrations.find((i) => i.kind === "linear");
  const jr = integrations.find((i) => i.kind === "jira");
  const hs = integrations.find((i) => i.kind === "hubspot");
  const sf = integrations.find((i) => i.kind === "salesforce");
  const on = (k: string) => enabledKinds.includes(k);
  const generic = trackers.map((tr) => ({
    entry: tr,
    status: integrations.find((i) => i.kind === tr.kind),
  }));
  const tracker =
    (on("github") ? gh : undefined) ??
    (on("linear") ? lin : undefined) ??
    (on("jira") ? jr : undefined) ??
    generic.find((g) => g.status)?.status;
  const connectedGeneric = generic.find((g) => g.status)?.entry.kind;
  return (
    <div className="space-y-4">
      {on("slack") ? (
        <SlackCard
          workspaceId={workspaceId}
          status={slack}
          available={slackAvailable}
        />
      ) : null}
      {on("github") && githubAvailable && !lin && !jr && !connectedGeneric ? (
        <GithubCard
          workspaceId={workspaceId}
          status={gh}
          statuses={statuses}
          mapping={{
            close: github?.closeStatusId,
            reopen: github?.reopenStatusId,
          }}
          webhookUrl={github?.webhookUrl}
        />
      ) : null}
      {on("linear") && githubAvailable && !gh && !jr && !connectedGeneric ? (
        <LinearCard
          workspaceId={workspaceId}
          status={lin}
          statuses={statuses}
          details={linear}
        />
      ) : null}
      {on("jira") && githubAvailable && !gh && !lin && !connectedGeneric ? (
        <JiraCard
          workspaceId={workspaceId}
          status={jr}
          statuses={statuses}
          details={jira}
        />
      ) : null}
      {githubAvailable && !gh && !lin && !jr
        ? generic
            .filter(
              (g) => !connectedGeneric || g.entry.kind === connectedGeneric,
            )
            .map((g) => (
              <TrackerCard
                key={g.entry.kind}
                workspaceId={workspaceId}
                entry={g.entry}
                status={g.status}
                statuses={statuses}
                details={trackerDetails[g.entry.kind]}
              />
            ))
        : null}
      {on("salesforce") && githubAvailable ? (
        <SalesforceCard
          workspaceId={workspaceId}
          status={sf}
          details={salesforce}
        />
      ) : null}
      {on("hubspot") && githubAvailable ? (
        <HubspotCard workspaceId={workspaceId} status={hs} details={hubspot} />
      ) : null}
      {githubAvailable && tracker ? (
        <p className="text-sm text-muted-foreground">
          One issue tracker is used at a time. Disconnect it to use a different
          one.
        </p>
      ) : null}
      {!githubAvailable ? (
        <p className="text-sm text-muted-foreground">
          Connections can&apos;t be stored on this server yet (it needs a
          SECRETS_KEY).
        </p>
      ) : null}
    </div>
  );
}
