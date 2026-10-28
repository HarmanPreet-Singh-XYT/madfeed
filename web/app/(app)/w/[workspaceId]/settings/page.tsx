import { StatusSettings } from "@/components/status-settings";
import { Suspense } from "react";
import Link from "next/link";
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
import { PageHeader } from "@/components/app/page-header";
import { SettingsGroup, StatusChip } from "@/components/app/panel";
import { ChangePasswordForm } from "@/components/change-password-form";
import { DeleteAccount } from "@/components/delete-account";
import { DeleteWorkspace } from "@/components/delete-workspace";
import { supabaseConfigured } from "@/lib/server/supabase-auth";

export const metadata = { title: "Settings" };

// The tabs of the page, and the groups on each. A tab with no groups for this person (a plan or role without them) is
// left out, so there is never an empty tab.
const TABS: { id: string; label: string; groups: string[] }[] = [
  {
    id: "general",
    label: "General",
    groups: ["team", "request-statuses", "weekly-digest"],
  },
  {
    id: "customers",
    label: "Customers",
    groups: [
      "messages-and-release-page",
      "feedback-form-for-your-website",
      "inbox-website-chat-and-email",
      "verified-voting",
    ],
  },
  { id: "integrations", label: "Integrations", groups: ["connections"] },
  {
    id: "developers",
    label: "Developers",
    groups: ["messages-to-other-tools", "api-keys-and-ai-assistants"],
  },
  { id: "billing", label: "Billing", groups: ["billing"] },
  {
    id: "account",
    label: "Account and data",
    groups: [
      "your-data",
      "your-password",
      "delete-your-account",
      "delete-this-workspace",
    ],
  },
];

type Props = {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ tab?: string; billing?: string }>;
};

export default function SettingsPage(props: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Settings {...props} />
    </Suspense>
  );
}

async function Settings({ params, searchParams }: Props) {
  const { workspaceId } = await params;
  const sp = await searchParams;
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
  const present = new Set<string>([
    "team",
    "messages-and-release-page",
    "weekly-digest",
    "feedback-form-for-your-website",
    "your-data",
    "delete-your-account",
    ...(billing ? ["billing"] : []),
    ...(inboxSettings ? ["inbox-website-chat-and-email"] : []),
    ...(ws.role === "admin" && statuses.length > 0 ? ["request-statuses"] : []),
    ...(conns ? ["connections"] : []),
    ...(hooks ? ["messages-to-other-tools"] : []),
    ...(apiKeys ? ["api-keys-and-ai-assistants"] : []),
    ...(voting ? ["verified-voting"] : []),
    ...(supabaseConfigured() ? ["your-password"] : []),
    ...(ws.role === "admin" ? ["delete-this-workspace"] : []),
  ]);
  const tabs = TABS.filter((t) => t.groups.some((g) => present.has(g)));
  // Coming back from checkout names no tab, only ?billing=…, and that belongs on Billing.
  const wanted = sp.tab ?? (sp.billing ? "billing" : "general");
  const tab = tabs.some((t) => t.id === wanted)
    ? wanted
    : (tabs[0]?.id ?? "general");
  return (
    <section className="space-y-6">
      <PageHeader
        title="Settings"
        description={`${ws.name} · your role: ${ws.role}`}
      />

      <nav aria-label="Settings sections" className="overflow-x-auto">
        <ul className="flex gap-1 border-b border-border">
          {tabs.map((t) => (
            <li key={t.id}>
              <Link
                href={`/w/${ws.id}/settings?tab=${t.id}`}
                aria-current={t.id === tab ? "page" : undefined}
                className={`inline-flex min-h-9 items-center border-b-2 px-3 text-[13px] font-medium whitespace-nowrap transition-colors ${t.id === tab ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              >
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div>
        <div className="max-w-4xl space-y-5">
          {tab === "general" ? (
            <>
              <SettingsGroup
                id="team"
                title="Team"
                description="Who can see this workspace's conversations, and what they can do."
              >
                <TeamSettings
                  workspaceId={ws.id}
                  members={membersList}
                  invites={invitesRes?.invitations ?? []}
                  emailEnabled={invitesRes?.emailEnabled ?? false}
                  isAdmin={ws.role === "admin"}
                />
              </SettingsGroup>
              {ws.role === "admin" && statuses.length > 0 ? (
                <SettingsGroup
                  id="request-statuses"
                  title="Request statuses"
                  description="The stages a request moves through, and which ones count as shipped."
                >
                  <StatusSettings workspaceId={ws.id} statuses={statuses} />
                </SettingsGroup>
              ) : null}
              <SettingsGroup
                id="weekly-digest"
                title="Weekly digest"
                description="A weekly summary by email."
                status={
                  <StatusChip on={digest.enabled}>
                    {digest.enabled ? "On" : "Off"}
                  </StatusChip>
                }
              >
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
              </SettingsGroup>
            </>
          ) : null}
          {tab === "customers" ? (
            <>
              <SettingsGroup
                id="messages-and-release-page"
                title="Messages and release page"
                description="How emails to customers are signed, and where your public release notes live."
              >
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
              </SettingsGroup>
              <SettingsGroup
                id="feedback-form-for-your-website"
                title="Feedback form for your website"
                description="A form you can add to your site. Submissions go to the review queue."
                status={
                  <StatusChip on={form.enabled}>
                    {form.enabled ? "On" : "Off"}
                  </StatusChip>
                }
              >
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
              </SettingsGroup>
              {inboxSettings ? (
                <SettingsGroup
                  id="inbox-website-chat-and-email"
                  title="Inbox: website chat and email"
                  description="Receive website chat and email conversations in the Inbox."
                >
                  <InboxSettings
                    workspaceId={ws.id}
                    initial={inboxSettings}
                    webUrl={
                      process.env.PUBLIC_WEB_URL ?? "https://YOUR-ADDRESS"
                    }
                    apiUrl={apiUrl}
                  />
                </SettingsGroup>
              ) : null}
              {voting ? (
                <SettingsGroup
                  id="verified-voting"
                  title="Verified voting"
                  description="Mark votes from known customers as verified."
                  status={
                    <StatusChip on={voting?.hasSecret}>
                      {voting?.hasSecret ? "Set up" : "Not set up"}
                    </StatusChip>
                  }
                >
                  <VotingSettings
                    workspaceId={ws.id}
                    hasSecret={voting.hasSecret}
                    slug={form.publicSlug}
                    webUrl={
                      process.env.PUBLIC_WEB_URL ?? "https://YOUR-ADDRESS"
                    }
                  />
                </SettingsGroup>
              ) : null}
            </>
          ) : null}
          {tab === "integrations" ? (
            <>
              {conns ? (
                <SettingsGroup
                  id="connections"
                  title="Connections"
                  description="Issue trackers, chat and CRMs."
                >
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
                </SettingsGroup>
              ) : null}
            </>
          ) : null}
          {tab === "developers" ? (
            <>
              {hooks ? (
                <SettingsGroup
                  id="messages-to-other-tools"
                  title="Messages to other tools"
                  description="Send signed messages to your own code, or to a chat channel."
                >
                  <WebhooksSettings
                    workspaceId={ws.id}
                    available={hooks.available}
                    events={hooks.events}
                    endpoints={hooks.endpoints}
                  />
                </SettingsGroup>
              ) : null}
              {apiKeys ? (
                <SettingsGroup
                  id="api-keys-and-ai-assistants"
                  title="API keys and AI assistants"
                  description="Let your tools and AI assistants read or add feedback."
                >
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
                </SettingsGroup>
              ) : null}
            </>
          ) : null}
          {tab === "billing" ? (
            <>
              {billing ? (
                <SettingsGroup
                  id="billing"
                  title="Billing"
                  description="Your plan and payment details."
                  status={
                    billing ? (
                      <StatusChip>{billing.plan.name} plan</StatusChip>
                    ) : undefined
                  }
                >
                  <BillingSettings workspaceId={ws.id} info={billing} />
                </SettingsGroup>
              ) : null}
            </>
          ) : null}
          {tab === "account" ? (
            <>
              <SettingsGroup
                id="your-data"
                title="Your data"
                description="Export everything in this workspace."
              >
                <p className="text-muted-foreground">
                  Download everything in this workspace: companies, people,
                  conversations, requests and the quotes behind them, as one
                  file you can keep or move.
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
              </SettingsGroup>
              {supabaseConfigured() ? (
                <SettingsGroup
                  id="your-password"
                  title="Your password"
                  description="Change the password you sign in with."
                >
                  <ChangePasswordForm />
                </SettingsGroup>
              ) : null}
              <SettingsGroup
                id="delete-your-account"
                title="Delete your account"
                description="Remove your account and what is linked to it."
              >
                <DeleteAccount
                  workspaceId={ws.id}
                  requestedAt={
                    accountRequest.open ? accountRequest.requestedAt : undefined
                  }
                />
              </SettingsGroup>
              {ws.role === "admin" ? (
                <SettingsGroup
                  id="delete-this-workspace"
                  title="Delete this workspace"
                  description="Remove this workspace and everything in it."
                  danger
                >
                  <DeleteWorkspace workspaceId={ws.id} name={ws.name} />
                </SettingsGroup>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
