import { on, created, MockError, notFound } from "../engine";
import { freshId } from "../ids";
import type { Store } from "../store";

// People and companies, the team, keys, webhooks, billing and the other things under Settings.

const W = "/v1/workspaces/{workspaceId}";
const now = () => new Date().toISOString();
const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();
const ME = "00000000-0000-4000-8000-0000000000a1";
const entitlements = {
  aiBudgetUsd: 5,
  recordings: true,
  apiKeys: 3,
  publicPages: true,
  digest: true,
  surveys: true,
  integrations: true,
  modules: ["feedback", "research", "surveys", "support"] as (
    "feedback" | "research" | "surveys" | "support"
  )[],
};
const plans = [
  {
    id: "free",
    name: "Free",
    priceText: "Free",
    forSale: false,
    entitlements: {
      ...entitlements,
      aiBudgetUsd: 1,
      recordings: false,
      apiKeys: 0,
      publicPages: false,
      digest: false,
      integrations: false,
    },
  },
  {
    id: "team",
    name: "Team",
    priceText: "Price not set",
    forSale: true,
    entitlements,
  },
];

// ---- workspace
on("GET", "/v1/workspaces", ({ s }) => ({
  workspaces: s.deleted ? [] : [s.workspace],
}));
on("POST", `${W}/delete`, ({ s, body }) => {
  if (String(body?.confirmName).trim() !== s.workspace.name)
    throw new MockError(
      400,
      "invalid_request",
      "Type the workspace's name exactly to confirm.",
    );
  s.deleted = true;
});
on(
  "GET",
  `${W}/export`,
  ({ s }) =>
    new Response(
      JSON.stringify(
        {
          version: "workspace-export-v1",
          workspace: s.workspace.name,
          people: s.people,
          requests: s.requests.map((r) => ({ id: r.id, title: r.title })),
        },
        null,
        2,
      ),
      { headers: { "Content-Type": "application/json" } },
    ),
);
on("GET", `${W}/quality`, ({ query }) => {
  const c = { accepted: 31, acceptedEdited: 6, dismissed: 9, stillOpen: 5 };
  const r = {
    accepted: 0.78,
    acceptedAsIs: 0.63,
    editedOfAccepted: 0.19,
    dismissed: 0.22,
  };
  return {
    days: Number(query.get("days") ?? 30),
    enoughData: true,
    minDecided: 20,
    total: { counts: c, rates: r },
    previous: {
      counts: { accepted: 24, acceptedEdited: 5, dismissed: 13, stillOpen: 4 },
      rates: {
        accepted: 0.65,
        acceptedAsIs: 0.51,
        editedOfAccepted: 0.21,
        dismissed: 0.35,
      },
    },
    bySource: [{ kind: "paste", counts: c, rates: r }],
    byWeek: [3, 2, 1, 0].map((w) => ({
      weekStart: ago(w * 7),
      counts: {
        accepted: 8 - w,
        acceptedEdited: 1,
        dismissed: 2,
        stillOpen: w,
      },
      rates: r,
    })),
    ai: [
      {
        task: "extract",
        provider: "nebius",
        model: "nvidia/nemotron-3-super-120b-a12b",
        calls: 64,
        errors: 1,
        costUsd: "0.41",
        inputTokens: 182000,
        outputTokens: 24000,
      },
      {
        task: "match",
        provider: "nebius",
        model: "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B",
        calls: 210,
        errors: 0,
        costUsd: "0.021",
        inputTokens: 94000,
        outputTokens: 7600,
      },
      {
        task: "brief",
        provider: "nebius",
        model: "nvidia/Nemotron-3-Ultra-550b-a55b",
        calls: 4,
        errors: 0,
        costUsd: "0.19",
        inputTokens: 12000,
        outputTokens: 3100,
      },
    ],
  };
});

// ---- your own account (not tied to one workspace)
const own = globalThis as unknown as { __mockAccountRequest?: string };
on("GET", "/v1/account/deletion-request", () =>
  own.__mockAccountRequest
    ? { open: true, requestedAt: own.__mockAccountRequest }
    : { open: false },
);
on("POST", "/v1/account/deletion-request", () => ({
  requestedAt: (own.__mockAccountRequest ??= now()),
}));
on(
  "DELETE",
  "/v1/account/deletion-request",
  () => void (own.__mockAccountRequest = undefined),
);

// ---- people and companies
const recount = (s: Store) => {
  for (const a of s.accounts)
    a.peopleCount = s.people.filter((p) => p.accountId === a.id).length;
};
const accountName = (s: Store, id?: string) =>
  s.accounts.find((a) => a.id === id)?.name;
on("GET", `${W}/accounts`, ({ s, query }) => {
  recount(s);
  const q = (query.get("q") ?? "").toLowerCase();
  const rows = s.accounts.filter((a) => !q || a.name.toLowerCase().includes(q));
  return { accounts: rows, total: rows.length };
});
on("POST", `${W}/accounts/merge`, ({ s, body }) => {
  if (body.sourceId === body.targetId)
    throw new MockError(400, "invalid_request", "Choose two different companies.");
  const target = s.accounts.find((a) => a.id === body.targetId);
  const source = s.accounts.find((a) => a.id === body.sourceId);
  if (!target || !source) throw new MockError(404, "not_found", "That company was not found.");
  for (const p of s.people) {
    if (p.accountId === source.id) {
      p.accountId = target.id;
      p.accountName = target.name;
    }
  }
  s.accounts = s.accounts.filter((a) => a.id !== source.id);
  recount(s);
});

on("GET", `${W}/accounts/{accountId}`, ({ s, params }) => {
  const a = s.accounts.find((x) => x.id === params.accountId);
  if (!a) throw new MockError(404, "not_found", "That account was not found.");
  return a;
});
on("POST", `${W}/accounts`, ({ s, body }) => {
  const a = {
    id: freshId(),
    name: String(body.name),
    domain: body.domain,
    revenue: body.revenue,
    plan: body.plan,
    renewalDate: body.renewalDate,
    peopleCount: 0,
  };
  s.accounts.push(a);
  return created({ id: a.id });
});
on("PUT", `${W}/accounts/{accountId}`, ({ s, params, body }) => {
  const a = s.accounts.find((x) => x.id === params.accountId);
  if (!a) throw notFound("That company");
  Object.assign(a, {
    name: String(body.name),
    domain: body.domain,
    revenue: body.revenue,
    plan: body.plan,
    renewalDate: body.renewalDate,
  });
  for (const p of s.people) if (p.accountId === a.id) p.accountName = a.name;
});
on("POST", `${W}/people`, ({ s, body }) => {
  const p = {
    id: freshId(),
    name: String(body.name ?? body.email ?? "Unnamed"),
    email: body.email,
    accountId: body.accountId,
    accountName: accountName(s, body.accountId),
  };
  s.people.push(p);
  recount(s);
  return created({ id: p.id });
});
on("PUT", `${W}/people/{personId}`, ({ s, params, body }) => {
  const p = s.people.find((x) => x.id === params.personId);
  if (!p) throw notFound("That person");
  Object.assign(p, {
    name: body.name ?? p.name,
    email: body.email ?? p.email,
    accountId: body.accountId ?? p.accountId,
    accountName: accountName(s, body.accountId ?? p.accountId),
  });
  recount(s);
});
on("POST", `${W}/people/merge`, ({ s, body }) => {
  if (body.sourceId === body.targetId)
    throw new MockError(400, "invalid_request", "Choose two different people.");
  if (!s.people.some((p) => p.id === body.targetId))
    throw new MockError(404, "not_found", "That person was not found.");
  s.people = s.people.filter((p) => p.id !== body.sourceId);
});

on("DELETE", `${W}/people/{personId}`, ({ s, params }) => {
  s.people = s.people.filter((p) => p.id !== params.personId);
  recount(s);
});

// A small stand-in for reading a spreadsheet: comma-separated, header row, columns found by name.
function parseCsv(
  csv: string,
  mapping: Record<string, string | undefined> = {},
) {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  const headers = (lines[0] ?? "").split(",").map((h) => h.trim());
  const find = (key: string, ...names: string[]) =>
    mapping[key] ?? headers.find((h) => names.includes(h.toLowerCase()));
  const map = {
    name: find("name", "name"),
    email: find("email", "email"),
    account: find("account", "account", "company"),
    domain: find("domain", "domain"),
    revenue: find("revenue", "revenue"),
    plan: find("plan", "plan"),
    renewal: find("renewal", "renewal"),
  };
  const rows = lines.slice(1).map((l) => l.split(",").map((c) => c.trim()));
  const col = (row: string[], key: keyof typeof map) =>
    map[key] ? row[headers.indexOf(map[key]!)] : undefined;
  const errors = rows.flatMap((row, i) =>
    col(row, "email") && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(col(row, "email")!)
      ? [
          {
            row: i + 2,
            column: map.email,
            message: "That is not an email address.",
          },
        ]
      : [],
  );
  return { headers, map, rows, col, errors };
}
on("POST", `${W}/people/import/preview`, ({ body }) => {
  const p = parseCsv(String(body.csv ?? ""), body.mapping);
  const mapping = Object.fromEntries(
    Object.entries(p.map).filter(([, v]) => v),
  );
  return {
    delimiter: ",",
    headers: p.headers,
    mapping,
    totalRows: p.rows.length,
    validRows: p.rows.length - p.errors.length,
    sample: p.rows.slice(0, 5),
    errors: p.errors,
    errorCount: p.errors.length,
    warnings: [],
  };
});
on("POST", `${W}/people/import`, ({ s, body }) => {
  const p = parseCsv(String(body.csv ?? ""), body.mapping);
  if (p.errors.length && !body.skipInvalidRows)
    throw new MockError(
      400,
      "invalid_request",
      "Some rows have problems. Fix them or choose to skip them.",
    );
  const bad = new Set(p.errors.map((e) => e.row));
  let accountsCreated = 0,
    peopleCreated = 0,
    peopleUpdated = 0;
  p.rows.forEach((row, i) => {
    if (bad.has(i + 2)) return;
    const an = p.col(row, "account");
    let acc = an ? s.accounts.find((a) => a.name === an) : undefined;
    if (an && !acc) {
      acc = {
        id: freshId(),
        name: an,
        domain: p.col(row, "domain"),
        revenue: p.col(row, "revenue"),
        plan: p.col(row, "plan"),
        peopleCount: 0,
      };
      s.accounts.push(acc);
      accountsCreated++;
    }
    const email = p.col(row, "email");
    const existing = email
      ? s.people.find((x) => x.email === email)
      : undefined;
    if (existing) {
      Object.assign(existing, {
        name: p.col(row, "name") ?? existing.name,
        accountId: acc?.id ?? existing.accountId,
        accountName: acc?.name ?? existing.accountName,
      });
      peopleUpdated++;
    } else {
      s.people.push({
        id: freshId(),
        name: p.col(row, "name") ?? email ?? "Unnamed",
        email,
        accountId: acc?.id,
        accountName: acc?.name,
      });
      peopleCreated++;
    }
  });
  recount(s);
  return {
    accountsCreated,
    accountsUpdated: 0,
    peopleCreated,
    peopleUpdated,
    skipped: bad.size,
  };
});

// ---- the website form, digest and voting
on("GET", `${W}/form`, ({ s }) => ({
  enabled: s.form.enabled,
  key: s.form.key,
  origins: s.form.origins,
  hasPublicAddress: Boolean(s.settings.publicSlug),
  publicSlug: s.settings.publicSlug,
}));
on("PUT", `${W}/form`, ({ s, body }) => {
  Object.assign(s.form, {
    enabled: Boolean(body.enabled),
    origins: body.origins ?? [],
  });
  if (body.rotateKey) s.form.key = `sample-form-key-${freshId().slice(0, 8)}`;
  return {
    enabled: s.form.enabled,
    key: s.form.key,
    origins: s.form.origins,
    hasPublicAddress: Boolean(s.settings.publicSlug),
    publicSlug: s.settings.publicSlug,
  };
});
on("POST", `${W}/form/forget`, () => ({ removed: 2 }));
const digest = (s: Store) => ({ ...s.digest, emailConfigured: true });
on("GET", `${W}/digest`, ({ s }) => digest(s));
on("PUT", `${W}/digest`, ({ s, body }) => {
  s.digest = {
    enabled: Boolean(body.enabled),
    weekday: body.weekday,
    hourUtc: body.hourUtc,
    recipients: (body.recipients as string[]).map((email) => ({
      email,
      unsubscribed: false,
    })),
  };
  return digest(s);
});
on("GET", `${W}/digest/preview`, ({ s }) => ({
  subject: `This week at ${s.workspace.name}`,
  text: `3 new requests, 5 new quotes.\n\nTop request: ${s.requests[0]?.title ?? "none yet"}\n\nOpen the app to see the rest.`,
  empty: s.requests.length === 0,
}));
on("GET", `${W}/voting`, ({ s }) => ({ hasSecret: s.votingSecret }));
on("POST", `${W}/voting/secret`, ({ s }) => {
  s.votingSecret = true;
  return { secret: `sample-signing-secret-${freshId().slice(0, 12)}` };
});

// ---- API keys, assistants and webhooks
on("GET", `${W}/api-keys`, ({ s }) => ({ keys: s.apiKeys }));
on("POST", `${W}/api-keys`, ({ s, body }) => {
  const key = {
    id: freshId(),
    name: String(body.name),
    prefix: `fb_${freshId().slice(0, 7)}`,
    createdAt: now(),
    revoked: false,
    scopes: body.scopes ?? ["requests", "quotes"],
    allowedCidrs: body.allowedCidrs ?? [],
    expiresAt: body.expiresInDays
      ? new Date(Date.now() + body.expiresInDays * DAY).toISOString()
      : undefined,
  };
  s.apiKeys.unshift(key);
  return created({
    key,
    secret: `${key.prefix}_sample_secret_shown_once_not_real`,
  });
});
on("DELETE", `${W}/api-keys/{keyId}`, ({ s, params }) => {
  const k = s.apiKeys.find((x) => x.id === params.keyId);
  if (!k) throw notFound("That key");
  k.revoked = true;
});
on("GET", `${W}/api-keys/{keyId}/events`, () => ({
  events: [
    { at: ago(0.1), action: "list" as const, detail: "requests", ok: true },
    {
      at: ago(1),
      action: "ask" as const,
      detail: "What is blocking rollouts?",
      ok: true,
    },
  ],
}));
on("GET", `${W}/oauth/grants`, ({ s }) => ({ grants: s.grants }));
on("DELETE", `${W}/oauth/grants/{grantId}`, ({ s, params }) => {
  s.grants = s.grants.filter((g) => g.id !== params.grantId);
});
on("GET", "/v1/oauth/clients/{clientId}", ({ params }) => ({
  name:
    params.clientId === "unknown" ? "Unknown assistant" : "Sample assistant",
  redirectUris: ["https://assistant.example/callback"],
}));
on("POST", "/v1/oauth/authorize", ({ s, body }) => {
  if (body.approve)
    s.grants.unshift({
      id: freshId(),
      clientName: "Sample assistant",
      scopes: body.scopes,
      createdAt: now(),
    });
  const u = new URL(body.redirectUri);
  if (body.approve) u.searchParams.set("code", "sample-code");
  else u.searchParams.set("error", "access_denied");
  if (body.state) u.searchParams.set("state", body.state);
  return { redirectUrl: u.toString() };
});

const EVENTS = ["request.status_changed", "release_note.published"];
on("GET", `${W}/webhooks`, ({ s }) => ({
  available: true,
  events: EVENTS,
  endpoints: s.webhooks.map((w) => w.endpoint),
}));
on("POST", `${W}/webhooks`, ({ s, body }) => {
  if (!/^https:\/\//.test(String(body.url)))
    throw new MockError(
      400,
      "invalid_request",
      "The address must start with https://.",
    );
  if (/localhost|127\.|10\.|192\.168\./.test(String(body.url)))
    throw new MockError(
      400,
      "invalid_request",
      "That address points at a private network, which messages cannot be sent to.",
    );
  const endpoint = {
    format: body.format ?? "json",
    id: freshId(),
    url: String(body.url),
    description: String(body.description ?? ""),
    events: body.events ?? EVENTS,
    enabled: true,
    pausedReason: "",
    consecutiveFailures: 0,
    createdAt: now(),
  };
  const secret = `whsec_sample_${freshId().replace(/-/g, "")}`;
  s.webhooks.unshift({ endpoint, secret, deliveries: [] });
  return created({ endpoint, secret });
});
const hook = (s: Store, id: string) => {
  const h = s.webhooks.find((x) => x.endpoint.id === id);
  if (!h) throw notFound("That address");
  return h;
};
on("PUT", `${W}/webhooks/{webhookId}`, ({ s, params, body }) => {
  Object.assign(hook(s, params.webhookId).endpoint, {
    url: String(body.url),
    description: String(body.description ?? ""),
    events: body.events,
    enabled: Boolean(body.enabled),
    format: body.format ?? "json",
    pausedReason: "",
    consecutiveFailures: 0,
  });
});
on("DELETE", `${W}/webhooks/{webhookId}`, ({ s, params }) => {
  hook(s, params.webhookId);
  s.webhooks = s.webhooks.filter((x) => x.endpoint.id !== params.webhookId);
});
on("POST", `${W}/webhooks/{webhookId}/secret`, ({ s, params }) => ({
  secret: (hook(s, params.webhookId).secret =
    `whsec_sample_${freshId().replace(/-/g, "")}`),
}));
on("POST", `${W}/webhooks/{webhookId}/test`, ({ s, params }) => {
  const h = hook(s, params.webhookId);
  h.deliveries.unshift({
    id: freshId(),
    eventType: "ping",
    state: "sent",
    attempts: 1,
    lastStatus: 200,
    lastError: "",
    createdAt: now(),
    sentAt: now(),
  });
  return new Response(null, { status: 202 });
});
on("GET", `${W}/webhooks/{webhookId}/deliveries`, ({ s, params }) => ({
  deliveries: hook(s, params.webhookId).deliveries,
}));

// ---- team
const inv = (s: Store, id: string) => {
  const i = s.team.invitations.find((x) => x.id === id);
  if (!i) throw notFound("That invitation");
  return i;
};
on("GET", `${W}/members`, ({ s }) => ({ members: s.team.members }));
on(
  "PUT",
  `${W}/members/me`,
  ({ s, body }) =>
    void (s.team.members.find((m) => m.isMe)!.name = String(body.name)),
);
on("PUT", `${W}/members/{userId}`, ({ s, params, body }) => {
  const m = s.team.members.find((x) => x.userId === params.userId);
  if (!m) throw notFound("That person");
  if (
    m.role === "admin" &&
    body.role !== "admin" &&
    s.team.members.filter((x) => x.role === "admin").length === 1
  )
    throw new MockError(
      409,
      "last_admin",
      "A workspace needs at least one admin.",
    );
  m.role = body.role;
  if (m.isMe) s.access.role = body.role;
});
on("DELETE", `${W}/members/{userId}`, ({ s, params }) => {
  const m = s.team.members.find((x) => x.userId === params.userId);
  if (!m) throw notFound("That person");
  if (
    m.role === "admin" &&
    s.team.members.filter((x) => x.role === "admin").length === 1
  )
    throw new MockError(
      409,
      "last_admin",
      "A workspace needs at least one admin.",
    );
  s.team.members = s.team.members.filter((x) => x.userId !== params.userId);
});
on("GET", `${W}/invitations`, ({ s }) => ({
  emailEnabled: true,
  invitations: s.team.invitations,
}));
on("POST", `${W}/invitations`, ({ s, body }) => {
  const email = String(body.email).toLowerCase();
  if (s.team.invitations.some((i) => i.email === email))
    throw new MockError(
      409,
      "conflict",
      "That address already has an open invitation.",
    );
  const i = {
    id: freshId(),
    email,
    role: body.role,
    createdAt: now(),
    expiresAt: new Date(Date.now() + 7 * DAY).toISOString(),
    lastSentAt: now(),
    link: "",
  };
  i.link = `http://localhost:3100/invite/${i.id}`;
  s.team.invitations.unshift(i);
  return created({ invitation: i, emailQueued: true });
});
on("DELETE", `${W}/invitations/{invitationId}`, ({ s, params }) => {
  inv(s, params.invitationId);
  s.team.invitations = s.team.invitations.filter(
    (i) => i.id !== params.invitationId,
  );
});
on("POST", `${W}/invitations/{invitationId}/resend`, ({ s, params }) => {
  const i = inv(s, params.invitationId);
  i.lastSentAt = now();
  i.expiresAt = new Date(Date.now() + 7 * DAY).toISOString();
  return { invitation: i, emailQueued: true };
});
on("GET", "/v1/invitations/{token}", ({ s, params }) => {
  const i = s.team.invitations.find((x) => x.id === params.token);
  if (!i) throw notFound("That invitation");
  return {
    workspaceName: s.workspace.name,
    role: i.role,
    email: i.email,
    state: "open" as const,
    alreadyMember: false,
    canAccept: true,
  };
});
on("POST", "/v1/invitations/{token}/accept", ({ s, params }) => {
  const i = s.team.invitations.find((x) => x.id === params.token);
  if (!i) throw notFound("That invitation");
  s.team.invitations = s.team.invitations.filter((x) => x.id !== i.id);
  return { workspaceId: s.workspace.id };
});

// ---- billing
const billing = (s: Store) => ({
  enabled: true,
  status: s.planId === "free" ? ("none" as const) : ("active" as const),
  cancelAtPeriodEnd: false,
  periodEnd: new Date(Date.now() + 18 * DAY).toISOString(),
  canManage: true,
  activeApiKeys: s.apiKeys.filter((k) => !k.revoked).length,
  events: [],
  plan: plans.find((p) => p.id === s.planId)!,
  plans,
});
on("GET", `${W}/billing`, ({ s }) => billing(s));
on("POST", `${W}/billing/checkout`, ({ s, body }) => {
  if (plans.some((p) => p.id === body.planId)) s.planId = body.planId;
  return { url: "/mock" };
});
on("POST", `${W}/billing/portal`, () => ({ url: "/mock" }));
