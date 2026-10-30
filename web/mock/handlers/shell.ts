import { on, created, MockError, notFound } from "../engine";
import { freshId } from "../ids";
import { resetStores, type Store } from "../store";

const W = "/v1/workspaces/{workspaceId}";
const ago = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

function activityFor(s: Store) {
  return [
    ...s.requests.map((r) => ({
      kind: "request",
      id: r.id,
      title: r.title,
      detail: r.status.name,
      at: r.createdAt,
    })),
    ...s.requests.flatMap((r) =>
      r.evidence.map((e) => ({
        kind: "quote",
        id: e.id,
        parentId: r.id,
        parentKind: "request",
        title: e.quote.slice(0, 160),
        detail: r.title,
        at: e.createdAt,
      })),
    ),
    ...s.highlights.map((h) => ({
      kind: "quote",
      id: h.id,
      parentId: h.sourceItemId,
      parentKind: "source",
      title: h.quote.slice(0, 160),
      detail: h.sourceTitle,
      at: h.createdAt,
    })),
    ...s.batches.flatMap((b) =>
      b.messages
        .filter((m) => m.state === "sent" && m.sentAt)
        .map((m) => ({
          kind: "message",
          id: m.id,
          parentId: b.id,
          parentKind: "batch",
          title: m.subject || "Message",
          detail: m.personName,
          at: m.sentAt as string,
        })),
    ),
    ...s.conversations.map((c) => ({
      kind: "conversation",
      id: c.id,
      title: c.subject || "Conversation",
      detail: c.channel,
      at: c.thread.at(-1)?.at ?? new Date(0).toISOString(),
    })),
    ...s.findings
      .filter((f) => f.state === "published" && f.publishedAt && !f.deletedAt)
      .map((f) => ({
        kind: "finding",
        id: f.id,
        title: f.title,
        detail: "Published",
        at: f.publishedAt as string,
      })),
    ...s.notes
      .filter((n) => n.state === "published" && n.publishedAt)
      .map((n) => ({
        kind: "release",
        id: n.id,
        title: n.title,
        detail: "Published",
        at: n.publishedAt as string,
      })),
    ...s.surveys
      .filter((x) => x.survey.state !== "draft")
      .map((x) => ({
        kind: "survey",
        id: x.survey.id,
        title: x.survey.title,
        detail: "Opened",
        at: x.survey.createdAt,
      })),
  ]
    .filter((a) => a.at)
    .sort((a, b) => b.at.localeCompare(a.at));
}

on("POST", "/v1/workspaces", ({ s, body }) =>
  created({
    id: s.workspace.id,
    name: String(body?.name ?? s.workspace.name),
    role: "admin",
  }),
);
// The preview has one seeded workspace, so "a sample workspace" is that one.
on("POST", "/v1/workspaces/sample", ({ s }) =>
  created({ id: s.workspace.id, name: "Sample workspace", role: "admin" }),
);
on("GET", `${W}/access`, ({ s }) => s.access);
on("GET", `${W}/shell`, ({ s }) => ({
  workspace: { id: s.workspace.id, name: s.workspace.name },
  ...s.access,
  waitingProposals: Math.min(
    100,
    s.proposals.filter((p) => p.state === "suggested").length,
  ),
  openOutreach: s.batches.filter(
    (b) => b.state === "review" || b.state === "drafting",
  ).length,
  unreadConversations: s.conversations.filter(
    (c) => c.state === "open" && (c.thread.at(-1)?.seq ?? 0) > (c.readSeq ?? 0),
  ).length,
  notices: s.access.permissions.includes("workspace:manage") ? s.notices : [],
}));
on("GET", `${W}/overview`, ({ s, query }) => {
  const days = [7, 30, 90].includes(Number(query.get("days")))
    ? Number(query.get("days"))
    : 30;
  const week = Date.now() - 7 * 86_400_000;
  const since = (value?: string) =>
    value ? new Date(value).getTime() >= week : false;
  const evidence = s.requests.flatMap((r) => r.evidence);
  return {
    generatedAt: new Date().toISOString(),
    counts: {
      openRequests: s.requests.filter((r) =>
        ["open", "active"].includes(r.status.bucket),
      ).length,
      shippedRequests: s.requests.filter((r) => r.status.bucket === "done")
        .length,
      people: s.people.length,
      accounts: s.accounts.length,
      quotes: evidence.length + s.highlights.length,
      suggestionsWaiting: s.proposals.filter((p) => p.state === "suggested")
        .length,
      messagesWaiting: s.batches
        .filter((b) => b.state === "review")
        .flatMap((b) => b.messages)
        .filter((m) => m.state === "draft").length,
      findings: s.findings.filter((f) => !f.deletedAt).length,
      surveysOpen: s.surveys.filter((x) => x.survey.state === "open").length,
      releasesPublished: s.notes.filter((n) => n.state === "published").length,
      requestsLast7d: s.requests.filter((r) => since(r.createdAt)).length,
      quotesLast7d:
        evidence.filter((e) => since((e as { createdAt?: string }).createdAt))
          .length + s.highlights.filter((h) => since(h.createdAt)).length,
      peopleLast7d: 0,
    },
    days,
    series: Array.from({ length: days }, (_, i) => {
      const d = new Date();
      d.setUTCHours(0, 0, 0, 0);
      d.setUTCDate(d.getUTCDate() - (days - 1 - i));
      const key = d.toISOString().slice(0, 10);
      const on = (value?: string) => value?.slice(0, 10) === key;
      return {
        day: key,
        requests: s.requests.filter((r) => on(r.createdAt)).length,
        quotes:
          s.requests.flatMap((r) => r.evidence).filter((e) => on(e.createdAt))
            .length + s.highlights.filter((h) => on(h.createdAt)).length,
        messages: s.batches
          .flatMap((b) => b.messages)
          .filter((m) => m.state === "sent" && on(m.sentAt)).length,
      };
    }),
    activity: activityFor(s).slice(0, 12),
  };
});
on("GET", `${W}/activity`, ({ s, query }) => {
  const kind = query.get("kind") ?? "";
  const limit = Math.min(50, Math.max(1, Number(query.get("limit") ?? 20)));
  const start = Math.max(0, Number(query.get("cursor") ?? 0) || 0);
  const all = activityFor(s).filter((a) => !kind || a.kind === kind);
  const items = all.slice(start, start + limit);
  const next = start + limit < all.length ? String(start + limit) : undefined;
  return { items, nextCursor: next };
});
on("GET", `${W}/notices`, ({ s }) => ({ notices: s.notices }));
on("GET", `${W}/settings`, ({ s }) => s.settings);
on("PUT", `${W}/settings`, ({ s, body }) => {
  if (typeof body?.publicSlug === "string")
    s.settings.publicSlug = body.publicSlug || undefined;
  if (typeof body?.senderName === "string")
    s.settings.senderName = body.senderName;
});

on("GET", `${W}/statuses`, ({ s }) => ({ statuses: s.statuses }));
on("POST", `${W}/statuses`, ({ s, body }) => {
  const id = freshId();
  s.statuses.push({
    id,
    name: String(body.name),
    bucket: body.bucket,
    position: s.statuses.length + 1,
  });
  return created({ id });
});
on("PUT", `${W}/statuses/{statusId}`, ({ s, params, body }) => {
  const st = s.statuses.find((x) => x.id === params.statusId);
  if (!st) throw notFound("That status");
  if (body.name !== undefined) st.name = String(body.name);
  if (body.bucket !== undefined)
    st.bucket = String(body.bucket) as typeof st.bucket;
  if (body.position !== undefined) st.position = Number(body.position);
});
on("PUT", `${W}/statuses/order`, ({ s, body }) => {
  const ids = (body.statusIds as string[]) ?? [];
  s.statuses.sort(
    (a, b) => ids.indexOf(a.id) - ids.indexOf(b.id),
  );
  s.statuses.forEach((st, i) => (st.position = i));
});
on("DELETE", `${W}/statuses/{statusId}`, ({ s, params }) => {
  const st = s.statuses.find((x) => x.id === params.statusId);
  const used = st ? s.requests.filter((r) => r.status.id === st.id).length : 0;
  if (used > 0)
    throw new MockError(
      409,
      "conflict",
      `${used} requests are still in this status; move them first`,
    );
  s.statuses = s.statuses.filter((x) => x.id !== params.statusId);
});

on("GET", `${W}/tags`, ({ s }) => ({ tags: s.tags }));
on("GET", `${W}/views`, ({ s }) => ({ views: s.views }));
on("POST", `${W}/views`, ({ s, body }) => {
  const v = {
    id: freshId(),
    name: String(body.name),
    statusId: body.statusId,
    tagId: body.tagId,
    q: body.q ?? "",
    sort: body.sort ?? "newest",
    mine: false,
    createdAt: new Date().toISOString(),
  };
  s.views.push(v);
  return created(v);
});
on("PUT", `${W}/views/{viewId}`, ({ s, params, body }) => {
  const v = s.views.find((x) => x.id === params.viewId);
  if (!v) throw new MockError(404, "not_found", "That view was not found.");
  v.name = String(body.name);
  v.statusId = body.statusId as string | undefined;
  v.tagId = body.tagId as string | undefined;
  v.q = String(body.q ?? "");
  v.sort = (body.sort === "value" ? "value" : "newest") as typeof v.sort;
  return v;
});
on("DELETE", `${W}/views/{viewId}`, ({ s, params }) => {
  const i = s.views.findIndex((v) => v.id === params.viewId);
  if (i < 0) throw new MockError(404, "not_found", "That view was not found.");
  s.views.splice(i, 1);
});

on("GET", `${W}/people/{personId}`, ({ s, params }) => {
  const i = s.people.findIndex((x) => x.id === params.personId);
  if (i < 0)
    throw new MockError(404, "not_found", "That person was not found.");
  // Same derived numbers the people list reports, so the two agree.
  return {
    ...s.people[i],
    createdAt: ago(120 - i * 9),
    quoteCount: (i + 1) * 2,
    lastHeardAt: i % 3 === 0 ? undefined : ago(i + 1),
  };
});
on("GET", `${W}/people`, ({ s, query }) => {
  const q = (query.get("q") ?? "").toLowerCase();
  const accountId = query.get("accountId");
  const email = query.get("email");
  const same = new Map<string, number>();
  for (const p of s.people) {
    const key = p.name.trim().toLowerCase();
    same.set(key, (same.get(key) ?? 0) + 1);
  }
  const all = s.people.map((p, i) => ({
    ...p,
    createdAt: ago(120 - i * 9),
    quoteCount: (i + 1) * 2,
    lastHeardAt: i % 3 === 0 ? undefined : ago(i + 1),
    similarName: (same.get(p.name.trim().toLowerCase()) ?? 0) > 1,
  }));
  const rows = all.filter(
    (p) =>
      (!q || p.name.toLowerCase().includes(q) || (p.email ?? "").includes(q)) &&
      (!accountId || p.accountId === accountId) &&
      (email !== "with" || !!p.email) &&
      (email !== "without" || !p.email),
  );
  return {
    people: rows,
    total: rows.length,
    stats: {
      total: all.length,
      withEmail: all.filter((p) => p.email).length,
      withoutEmail: all.filter((p) => !p.email).length,
    },
  };
});

// Not part of the real API: the preview index uses it to put the sample data back.
on("POST", "/__mock/reset", () => resetStores());
