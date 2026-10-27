import { on, MockError, notFound } from "../engine";
import type { Store } from "../store";

// Connections to other tools: chat, issue trackers and customer-data tools. "Connecting" keeps what was entered
// and shows the connection as working; nothing leaves the preview.

const W = "/v1/workspaces/{workspaceId}";
const now = () => new Date().toISOString();
const KINDS = [
  "slack",
  "github",
  "linear",
  "jira",
  "hubspot",
  "clickup",
  "asana",
  "azuredevops",
  "salesforce",
] as const;
type Kind = (typeof KINDS)[number];
const TRACKERS = [
  "github",
  "linear",
  "jira",
  "clickup",
  "asana",
  "azuredevops",
] as const;
const hook = (kind: string) =>
  `https://api.example/v1/integrations/${kind}/00000000-0000-4000-8000-000000000001/events`;

function connect(
  s: Store,
  kind: Kind,
  summary: string,
  detail: string,
  config: Record<string, string> = {},
) {
  s.integrations[kind] = { summary, detail, connectedAt: now(), config };
}
const conn = (s: Store, kind: string) => {
  const c = s.integrations[kind];
  if (!c) throw new MockError(404, "not_found", "That tool is not connected.");
  return c;
};

on("GET", `${W}/integrations`, ({ s }) => ({
  enabledKinds: [...KINDS],
  slackAvailable: true,
  githubAvailable: true,
  integrations: Object.entries(s.integrations).map(([kind, c]) => ({
    kind: kind as Kind,
    state: "connected" as const,
    summary: c.summary,
    detail: c.detail,
    lastOkAt: c.connectedAt,
    lastError: "",
    connectedAt: c.connectedAt,
  })),
}));
on("DELETE", `${W}/integrations/{kind}`, ({ s, params }) => {
  conn(s, params.kind);
  delete s.integrations[params.kind];
});

// ---- Slack
on("POST", `${W}/integrations/slack/connect`, () => ({
  url: "/integrations/slack/callback?code=sample-code&state=sample-state",
}));
on("POST", "/v1/integrations/slack/complete", ({ s }) => {
  connect(
    s,
    "slack",
    "Connected to Northwind (sample)",
    "No channel chosen yet",
  );
  return { workspaceId: s.workspace.id, team: "Northwind" };
});
on("GET", `${W}/integrations/slack/channels`, () => ({
  channels: [
    { id: "C01", name: "customer-feedback" },
    { id: "C02", name: "product" },
    { id: "C03", name: "support" },
  ],
}));
on("PUT", `${W}/integrations/slack/channel`, ({ s, body }) => {
  const c = conn(s, "slack");
  const name =
    (
      { C01: "customer-feedback", C02: "product", C03: "support" } as Record<
        string,
        string
      >
    )[body.channelId] ?? "channel";
  c.config.channelId = body.channelId;
  c.detail = `Reading messages from #${name}`;
});
on("POST", `${W}/integrations/slack/check`, ({ s }) => void conn(s, "slack"));

// ---- issue trackers with their own screens
const mapping = (c: { config: Record<string, string> }) => ({
  closeStatusId: c.config.closeStatusId || undefined,
  reopenStatusId: c.config.reopenStatusId || undefined,
});
const keep = (body: { closeStatusId?: string; reopenStatusId?: string }) => ({
  closeStatusId: body.closeStatusId ?? "",
  reopenStatusId: body.reopenStatusId ?? "",
});

on("GET", `${W}/integrations/github/details`, ({ s }) => {
  const c = conn(s, "github");
  return {
    repo: c.config.repo,
    state: "connected" as const,
    webhookUrl: hook("github"),
    ...mapping(c),
  };
});
on("POST", `${W}/integrations/github/connect`, ({ s, body }) => {
  if (!/^[\w.-]+\/[\w.-]+$/.test(String(body.repo)))
    throw new MockError(
      400,
      "invalid_request",
      "Write the repository as owner/name, for example acme/website.",
    );
  connect(
    s,
    "github",
    `Opening issues in ${body.repo}`,
    "Closing an issue moves the request",
    { repo: body.repo, ...keep(body) },
  );
  return {
    webhookUrl: hook("github"),
    webhookSecret: "sample-webhook-secret-not-real",
  };
});
on(
  "PUT",
  `${W}/integrations/github/mapping`,
  ({ s, body }) => void Object.assign(conn(s, "github").config, keep(body)),
);
on("POST", `${W}/integrations/github/check`, ({ s }) => void conn(s, "github"));

on("GET", `${W}/integrations/linear/details`, ({ s }) => {
  const c = conn(s, "linear");
  return {
    teamKey: c.config.teamKey,
    teamName: `${c.config.teamKey} team`,
    state: "connected" as const,
    webhookUrl: hook("linear"),
    hasSecret: Boolean(c.config.secret),
    ...mapping(c),
  };
});
on("POST", `${W}/integrations/linear/connect`, ({ s, body }) => {
  connect(
    s,
    "linear",
    `Opening issues in team ${body.teamKey}`,
    "Closing an issue moves the request",
    { teamKey: String(body.teamKey), ...keep(body) },
  );
  return { webhookUrl: hook("linear") };
});
on(
  "PUT",
  `${W}/integrations/linear/secret`,
  ({ s, body }) => void (conn(s, "linear").config.secret = String(body.secret)),
);
on(
  "PUT",
  `${W}/integrations/linear/mapping`,
  ({ s, body }) => void Object.assign(conn(s, "linear").config, keep(body)),
);
on("POST", `${W}/integrations/linear/check`, ({ s }) => void conn(s, "linear"));

on("GET", `${W}/integrations/jira/details`, ({ s }) => {
  const c = conn(s, "jira");
  return {
    site: c.config.site,
    project: c.config.project,
    issueType: c.config.issueType,
    state: "connected" as const,
    webhookUrl: hook("jira"),
    ...mapping(c),
  };
});
on("POST", `${W}/integrations/jira/connect`, ({ s, body }) => {
  connect(
    s,
    "jira",
    `Opening issues in ${body.project}`,
    `${body.site}.atlassian.net`,
    {
      site: String(body.site),
      project: String(body.project),
      issueType: String(body.issueType ?? "Task"),
      ...keep(body),
    },
  );
  return {
    webhookUrl: hook("jira"),
    webhookSecret: "sample-webhook-secret-not-real",
  };
});
on(
  "PUT",
  `${W}/integrations/jira/mapping`,
  ({ s, body }) => void Object.assign(conn(s, "jira").config, keep(body)),
);
on("POST", `${W}/integrations/jira/check`, ({ s }) => void conn(s, "jira"));

// ---- the trackers that share one screen
const trackerInfo = {
  clickup: {
    name: "ClickUp",
    intro:
      "Open a task for a request, and let the task's status move the request.",
    fields: [
      {
        name: "listId",
        label: "List id",
        help: "The list new tasks go into.",
        secret: false,
        optional: false,
      },
      {
        name: "token",
        label: "Personal token",
        help: "Stored encrypted.",
        secret: true,
        optional: false,
      },
    ],
  },
  asana: {
    name: "Asana",
    intro: "Open a task for a request, and let completing it move the request.",
    fields: [
      {
        name: "projectId",
        label: "Project id",
        help: "The project new tasks go into.",
        secret: false,
        optional: false,
      },
      {
        name: "token",
        label: "Personal access token",
        help: "Stored encrypted.",
        secret: true,
        optional: false,
      },
    ],
  },
  azuredevops: {
    name: "Azure DevOps",
    intro: "Open a work item for a request.",
    fields: [
      {
        name: "organization",
        label: "Organisation",
        help: "",
        secret: false,
        optional: false,
      },
      {
        name: "project",
        label: "Project",
        help: "",
        secret: false,
        optional: false,
      },
      {
        name: "workItemType",
        label: "Work item type",
        help: "For example Task.",
        secret: false,
        optional: true,
      },
      {
        name: "token",
        label: "Personal access token",
        help: "Stored encrypted.",
        secret: true,
        optional: false,
      },
    ],
  },
};
on("GET", `${W}/integrations/trackers`, () => ({
  trackers: Object.entries(trackerInfo).map(([kind, t]) => ({
    kind: kind as keyof typeof trackerInfo,
    ...t,
  })),
}));
on(
  "GET",
  `${W}/integrations/trackers/{trackerKind}/details`,
  ({ s, params }) => {
    const c = conn(s, params.trackerKind);
    return {
      summary: c.summary,
      detail: c.detail,
      state: "connected" as const,
      webhookUrl: hook(params.trackerKind),
      ...mapping(c),
    };
  },
);
on(
  "POST",
  `${W}/integrations/trackers/{trackerKind}/connect`,
  ({ s, params, body }) => {
    const info = trackerInfo[params.trackerKind as keyof typeof trackerInfo];
    if (!info) throw notFound("That tool");
    connect(
      s,
      params.trackerKind as Kind,
      `Opening items in ${info.name}`,
      "Completing an item moves the request",
      { ...keep(body) },
    );
    return {
      webhookUrl: hook(params.trackerKind),
      note: `One more step in ${info.name}: add the address below as a webhook.`,
      show: [
        {
          label: "Webhook address",
          value: hook(params.trackerKind),
          secret: false,
        },
      ],
    };
  },
);
on(
  "PUT",
  `${W}/integrations/trackers/{trackerKind}/mapping`,
  ({ s, params, body }) =>
    void Object.assign(conn(s, params.trackerKind).config, keep(body)),
);
on(
  "POST",
  `${W}/integrations/trackers/{trackerKind}/check`,
  ({ s, params }) => void conn(s, params.trackerKind),
);

// ---- customer-data tools
const lastSync = () => ({
  at: now(),
  ok: true,
  people: 6,
  matched: 5,
  peopleLinked: 5,
  accountsCreated: 1,
  accountsUpdated: 3,
  skipped: 0,
});
for (const kind of ["hubspot", "salesforce"] as const) {
  on("GET", `${W}/integrations/${kind}/details`, ({ s }) => {
    const c = conn(s, kind);
    return {
      state: "connected" as const,
      valueFrom: (c.config.valueFrom ?? "revenue") as "revenue",
      syncing: false,
      instanceUrl: c.config.instanceUrl ?? "",
      lastSync: c.config.synced ? lastSync() : undefined,
    };
  });
  on("POST", `${W}/integrations/${kind}/sync`, ({ s }) => {
    conn(s, kind).config.synced = "1";
    return new Response(null, { status: 202 });
  });
}
on(
  "POST",
  `${W}/integrations/hubspot/connect`,
  ({ s, body }) =>
    void connect(
      s,
      "hubspot",
      "Reading account value from HubSpot",
      `Value from ${body.valueFrom}`,
      { valueFrom: body.valueFrom },
    ),
);
on(
  "POST",
  `${W}/integrations/salesforce/connect`,
  ({ s, body }) =>
    void connect(
      s,
      "salesforce",
      "Reading account value from Salesforce",
      String(body.instanceUrl),
      { valueFrom: body.valueFrom, instanceUrl: String(body.instanceUrl) },
    ),
);

// ---- the issue linked to a request
const request = (s: Store, id: string) => {
  const r = s.requests.find((x) => x.id === id);
  if (!r) throw notFound("That request");
  return r;
};
on("GET", `${W}/requests/{requestId}/issue`, ({ s, params }) => {
  request(s, params.requestId);
  const i = s.issues[params.requestId];
  if (!i)
    throw new MockError(
      404,
      "not_found",
      "No issue is linked to this request.",
    );
  return i;
});
on("POST", `${W}/requests/{requestId}/issue`, ({ s, params }) => {
  const r = request(s, params.requestId);
  const tracker = TRACKERS.find((k) => s.integrations[k]);
  if (!tracker)
    throw new MockError(
      409,
      "not_connected",
      "Connect an issue tracker in Settings first.",
    );
  const number = 100 + Object.keys(s.issues).length + 1;
  const link = {
    label: `${tracker}#${number}: ${r.title}`,
    ref: `${number}`,
    tracker,
    repo: s.integrations[tracker].config.repo ?? "northwind/product",
    number,
    url: `https://tracker.example/${tracker}/${number}`,
    state: "open" as const,
    conflict: "",
    updatedAt: now(),
  };
  s.issues[r.id] = link;
  return new Response(JSON.stringify(link), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  });
});
on(
  "DELETE",
  `${W}/requests/{requestId}/issue`,
  ({ s, params }) => void delete s.issues[params.requestId],
);
on("POST", `${W}/requests/{requestId}/issue/resolve`, ({ s, params }) => {
  const i = s.issues[params.requestId];
  if (i) i.conflict = "";
});
