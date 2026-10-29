import { on, created, MockError, notFound } from "../engine";
import { freshId } from "../ids";
import { resetStores } from "../store";

const W = "/v1/workspaces/{workspaceId}";
const ago = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

on("POST", "/v1/workspaces", ({ s, body }) =>
  created({
    id: s.workspace.id,
    name: String(body?.name ?? s.workspace.name),
    role: "admin",
  }),
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
    (c) =>
      c.state === "open" && (c.thread.at(-1)?.seq ?? 0) > (c.readSeq ?? 0),
  ).length,
  notices: s.access.permissions.includes("workspace:manage") ? s.notices : [],
}));
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
  st.name = String(body.name);
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
  const p = s.people.find((x) => x.id === params.personId);
  if (!p) throw new MockError(404, "not_found", "That person was not found.");
  return p;
});
on("GET", `${W}/people`, ({ s, query }) => {
  const q = (query.get("q") ?? "").toLowerCase();
  const accountId = query.get("accountId");
  const email = query.get("email");
  const all = s.people.map((p, i) => ({
    ...p,
    createdAt: ago(120 - i * 9),
    quoteCount: (i + 1) * 2,
    lastHeardAt: i % 3 === 0 ? undefined : ago(i + 1),
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
