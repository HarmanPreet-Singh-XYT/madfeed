import { StatusSettings } from "@/components/status-settings";
import { Suspense } from "react";
import { api, unwrap } from "@/lib/server/api";
import { getWorkspace } from "@/lib/server/queries";
import { Loading } from "@/components/loading";
import { SettingsForm } from "@/components/settings-form";
import { FeedbackFormSettings } from "@/components/feedback-form-settings";
import { DigestSettings } from "@/components/digest-settings";
import { VotingSettings } from "@/components/voting-settings";
import { ApiKeysSettings } from "@/components/api-keys-settings";
import { ConnectedAssistants } from "@/components/connected-assistants";
import { InboxSettings } from "@/components/inbox-settings";
import { BillingSettings } from "@/components/billing-settings";
import { ConnectionsSettings } from "@/components/connections-settings";
import { TeamSettings } from "@/components/team-settings";
import { WebhooksSettings } from "@/components/webhooks-settings";
import { card } from "@/components/ui";
import { ChangePasswordForm } from "@/components/change-password-form";
import { DeleteAccount } from "@/components/delete-account";
import { DeleteWorkspace } from "@/components/delete-workspace";
import { supabaseConfigured } from "@/lib/server/supabase-auth";

export const metadata = { title: "Settings" };

type Props = { params: Promise<{ workspaceId: string }> };

export default function SettingsPage(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Settings {...props} />
    </Suspense>
  );
}

async function Settings({ params }: Props) {
  const { workspaceId } = await params;
  const ws = await getWorkspace(workspaceId);
  const s = unwrap(
    await (
      await api()
    ).GET("/v1/workspaces/{workspaceId}/settings", {
      params: { path: { workspaceId: ws.id } },
    }),
  );
  const form = unwrap(
    await (
      await api()
    ).GET("/v1/workspaces/{workspaceId}/form", {
      params: { path: { workspaceId: ws.id } },
    }),
  );
  const digest = unwrap(
    await (
      await api()
    ).GET("/v1/workspaces/{workspaceId}/digest", {
      params: { path: { workspaceId: ws.id } },
    }),
  );
  const voting =
    ws.role === "admin"
      ? unwrap(
          await (
            await api()
          ).GET("/v1/workspaces/{workspaceId}/voting", {
            params: { path: { workspaceId: ws.id } },
          }),
        )
      : undefined;
  const apiKeys =
    ws.role === "admin"
      ? unwrap(
          await (
            await api()
          ).GET("/v1/workspaces/{workspaceId}/api-keys", {
            params: { path: { workspaceId: ws.id } },
          }),
        )
      : undefined;
  const client = await api();
  const assistants =
    ws.role === "admin"
      ? (
          await client.GET("/v1/workspaces/{workspaceId}/oauth/grants", {
            params: { path: { workspaceId: ws.id } },
          })
        ).data?.grants
      : undefined;
  const inboxSettings =
    ws.role === "admin"
      ? unwrap(
          await client.GET("/v1/workspaces/{workspaceId}/inbox/settings", {
            params: { path: { workspaceId: ws.id } },
          }),
        )
      : undefined;
  const billing =
    ws.role === "admin"
      ? unwrap(
          await client.GET("/v1/workspaces/{workspaceId}/billing", {
            params: { path: { workspaceId: ws.id } },
          }),
        )
      : undefined;
  const conns =
    ws.role === "admin"
      ? unwrap(
          await client.GET("/v1/workspaces/{workspaceId}/integrations", {
            params: { path: { workspaceId: ws.id } },
          }),
        )
      : undefined;
  const hooks =
    ws.role === "admin"
      ? unwrap(
          await client.GET("/v1/workspaces/{workspaceId}/webhooks", {
            params: { path: { workspaceId: ws.id } },
          }),
        )
      : undefined;
  const accountRequest = unwrap(
    await client.GET("/v1/account/deletion-request"),
  );
  const statuses =
    ws.role === "admin"
      ? unwrap(
          await client.GET("/v1/workspaces/{workspaceId}/statuses", {
            params: { path: { workspaceId: ws.id } },
          }),
        ).statuses
      : [];
  const ghDetails = conns?.integrations.some((i) => i.kind === "github")
    ? (
        await client.GET(
          "/v1/workspaces/{workspaceId}/integrations/github/details",
          {
            params: { path: { workspaceId: ws.id } },
          },
        )
      ).data
    : undefined;
  const linDetails = conns?.integrations.some(
    (i) => i.kind === "linear" && conns.enabledKinds.includes("linear"),
  )
    ? (
        await client.GET(
          "/v1/workspaces/{workspaceId}/integrations/linear/details",
          { params: { path: { workspaceId: ws.id } } },
        )
      ).data
    : undefined;
  const jiraDetails = conns?.integrations.some(
    (i) => i.kind === "jira" && conns.enabledKinds.includes("jira"),
  )
    ? (
        await client.GET(
          "/v1/workspaces/{workspaceId}/integrations/jira/details",
          { params: { path: { workspaceId: ws.id } } },
        )
      ).data
    : undefined;
  const hubspotDetails = conns?.integrations.some(
    (i) => i.kind === "hubspot" && conns.enabledKinds.includes("hubspot"),
  )
    ? (
        await client.GET(
          "/v1/workspaces/{workspaceId}/integrations/hubspot/details",
          { params: { path: { workspaceId: ws.id } } },
        )
      ).data
    : undefined;
  const trackers =
    conns &&
    conns.enabledKinds.some((k) =>
      ["clickup", "asana", "azuredevops"].includes(k),
    )
      ? ((
          await client.GET(
            "/v1/workspaces/{workspaceId}/integrations/trackers",
            {
              params: { path: { workspaceId: ws.id } },
            },
          )
        ).data?.trackers ?? [])
      : [];
  const trackerDetails: Record<
    string,
    { webhookUrl: string; closeStatusId?: string; reopenStatusId?: string }
  > = {};
  for (const tr of trackers) {
    if (!conns?.integrations.some((i) => i.kind === tr.kind)) continue;
    const d = (
      await client.GET(
        "/v1/workspaces/{workspaceId}/integrations/trackers/{trackerKind}/details",
        { params: { path: { workspaceId: ws.id, trackerKind: tr.kind } } },
      )
    ).data;
    if (d) trackerDetails[tr.kind] = d;
  }
  const salesforceDetails = conns?.integrations.some(
    (i) => i.kind === "salesforce" && conns.enabledKinds.includes("salesforce"),
  )
    ? (
        await client.GET(
          "/v1/workspaces/{workspaceId}/integrations/salesforce/details",
          { params: { path: { workspaceId: ws.id } } },
        )
      ).data
    : undefined;
  const membersList = unwrap(
    await client.GET("/v1/workspaces/{workspaceId}/members", {
      params: { path: { workspaceId: ws.id } },
    }),
  ).members;
  const invitesRes =
    ws.role === "admin"
      ? unwrap(
          await client.GET("/v1/workspaces/{workspaceId}/invitations", {
            params: { path: { workspaceId: ws.id } },
          }),
        )
      : undefined;
  const apiUrl = process.env.PUBLIC_API_URL ?? "http://localhost:8080";
  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-muted-foreground">
          {ws.name} · your role: {ws.role}
        </p>
      </div>

      <div className={`${card} space-y-3`}>
        <h2 className="text-lg font-medium">Team</h2>
        <TeamSettings
          workspaceId={ws.id}
          members={membersList}
          invites={invitesRes?.invitations ?? []}
          emailEnabled={invitesRes?.emailEnabled ?? false}
          isAdmin={ws.role === "admin"}
        />
      </div>

      <div className={`${card} space-y-3`}>
        <h2 className="text-lg font-medium">Messages and release page</h2>
        {ws.role === "admin" ? (
          <SettingsForm
            workspaceId={ws.id}
            publicSlug={s.publicSlug ?? ""}
            senderName={s.senderName}
          />
        ) : (
          <p className="text-muted-foreground">
            Messages are signed “{s.senderName || ws.name}”.{" "}
            {s.publicSlug
              ? `The public release page is at /r/${s.publicSlug}.`
              : "There is no public release page."}{" "}
            Only workspace admins can change these.
          </p>
        )}
      </div>

      <div className={`${card} space-y-3`}>
        <h2 className="text-lg font-medium">Feedback form for your website</h2>
        {ws.role === "admin" ? (
          <FeedbackFormSettings
            workspaceId={ws.id}
            enabled={form.enabled}
            keyValue={form.key}
            origins={form.origins}
            slug={form.publicSlug}
            apiUrl={apiUrl}
          />
        ) : (
          <p className="text-muted-foreground">
            {form.enabled
              ? "The feedback form is on."
              : "The feedback form is off."}{" "}
            Only workspace admins can change it.
          </p>
        )}
      </div>

      {billing ? (
        <div className={`${card} space-y-3`}>
          <h2 className="text-lg font-medium">Billing</h2>
          <BillingSettings workspaceId={ws.id} info={billing} />
        </div>
      ) : null}

      {inboxSettings ? (
        <div className={`${card} space-y-3`}>
          <h2 className="text-lg font-medium">Inbox: website chat and email</h2>
          <InboxSettings
            workspaceId={ws.id}
            initial={inboxSettings}
            webUrl={process.env.PUBLIC_WEB_URL ?? "https://YOUR-ADDRESS"}
            apiUrl={apiUrl}
          />
        </div>
      ) : null}

      {ws.role === "admin" && statuses.length > 0 ? (
        <div className={`${card} space-y-3`}>
          <h2 className="text-lg font-medium">Request statuses</h2>
          <StatusSettings workspaceId={ws.id} statuses={statuses} />
        </div>
      ) : null}

      {conns ? (
        <div className={`${card} space-y-3`}>
          <h2 className="text-lg font-medium">Connections</h2>
          <ConnectionsSettings
            workspaceId={ws.id}
            statuses={statuses}
            slackAvailable={conns.slackAvailable}
            githubAvailable={conns.githubAvailable}
            integrations={conns.integrations}
            github={ghDetails}
            linear={linDetails}
            jira={jiraDetails}
            hubspot={hubspotDetails}
            salesforce={salesforceDetails}
            enabledKinds={conns.enabledKinds}
            trackers={trackers}
            trackerDetails={trackerDetails}
          />
        </div>
      ) : null}

      {hooks ? (
        <div className={`${card} space-y-3`}>
          <h2 className="text-lg font-medium">Messages to other tools</h2>
          <WebhooksSettings
            workspaceId={ws.id}
            available={hooks.available}
            events={hooks.events}
            endpoints={hooks.endpoints}
          />
        </div>
      ) : null}

      {apiKeys ? (
        <div className={`${card} space-y-3`}>
          <h2 className="text-lg font-medium">API keys and AI assistants</h2>
          <ApiKeysSettings
            workspaceId={ws.id}
            keys={apiKeys.keys}
            apiUrl={apiUrl}
          />
          <ConnectedAssistants
            workspaceId={ws.id}
            grants={assistants ?? []}
            apiUrl={apiUrl}
          />
        </div>
      ) : null}

      {voting ? (
        <div className={`${card} space-y-3`}>
          <h2 className="text-lg font-medium">Verified voting</h2>
          <VotingSettings
            workspaceId={ws.id}
            hasSecret={voting.hasSecret}
            slug={form.publicSlug}
            webUrl={process.env.PUBLIC_WEB_URL ?? "https://YOUR-ADDRESS"}
          />
        </div>
      ) : null}

      <div className={`${card} space-y-3`}>
        <h2 className="text-lg font-medium">Weekly digest</h2>
        {ws.role === "admin" ? (
          <DigestSettings
            workspaceId={ws.id}
            enabled={digest.enabled}
            weekday={digest.weekday}
            hourUtc={digest.hourUtc}
            recipients={digest.recipients}
            emailConfigured={digest.emailConfigured}
          />
        ) : (
          <p className="text-muted-foreground">
            {digest.enabled
              ? `A weekly summary goes to ${digest.recipients.length} ${digest.recipients.length === 1 ? "person" : "people"}.`
              : "The weekly digest is off."}{" "}
            Only workspace admins can change it.
          </p>
        )}
      </div>

      <div className={`${card} space-y-3`}>
        <h2 className="text-lg font-medium">Your data</h2>
        <p className="text-muted-foreground">
          Download everything in this workspace: companies, people,
          conversations, requests and the quotes behind them, as one file you
          can keep or move.
        </p>
        {ws.role === "admin" ? (
          <a
            href={`/w/${ws.id}/export`}
            download
            className="inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
          >
            Download all data (JSON)
          </a>
        ) : (
          <p className="text-sm text-muted-foreground">
            Only workspace admins can download everything.
          </p>
        )}
      </div>

      {supabaseConfigured() ? (
        <div className={`${card} space-y-3`}>
          <h2 className="text-lg font-medium">Your password</h2>
          <ChangePasswordForm />
        </div>
      ) : null}

      <div className={`${card} space-y-3`}>
        <h2 className="text-lg font-medium">Delete your account</h2>
        <DeleteAccount
          workspaceId={ws.id}
          requestedAt={
            accountRequest.open ? accountRequest.requestedAt : undefined
          }
        />
      </div>

      {ws.role === "admin" ? (
        <div className={`${card} space-y-3 border-destructive`}>
          <h2 className="text-lg font-medium text-destructive">
            Delete this workspace
          </h2>
          <DeleteWorkspace workspaceId={ws.id} name={ws.name} />
        </div>
      ) : null}
    </section>
  );
}
