import { on, created, MockError, notFound } from "../engine";
import { freshId } from "../ids";
import type { Store } from "../store";

// Findings documents: text, headings and quote cards that can be shared by a link.

const W = "/v1/workspaces/{workspaceId}";
const now = () => new Date().toISOString();
const link = (id: string) => `/f/${id}`;
type Block = Store["findings"][number]["blocks"][number];

const doc = (s: Store, id: string) => {
  const d = s.findings.find((x) => x.id === id && !x.deletedAt);
  if (!d) throw notFound("That document");
  return d;
};

const clone = (blocks: Block[]) => blocks.map((b) => ({ ...b }));

/** A saved copy of the document as it is now; the newest fifty are kept. */
function snapshot(d: Store["findings"][number]) {
  d.versions ??= [];
  d.versions.unshift({
    id: freshId(),
    title: d.title,
    blocks: clone(d.blocks),
    createdAt: now(),
  });
  d.versions = d.versions.slice(0, 50);
}

/** Looks up the words, the conversation and the request behind a quote card. A card whose quote is gone says so. */
function resolve(s: Store, b: Block) {
  if (b.kind === "text" || b.kind === "heading")
    return { id: b.id, kind: b.kind, body: b.body, removed: false };
  if (b.quoteKind === "highlight") {
    const h = s.highlights.find((x) => x.id === b.quoteId);
    if (!h)
      return {
        id: b.id,
        kind: b.kind,
        body: b.body,
        quoteKind: b.quoteKind,
        quoteId: b.quoteId,
        removed: true,
      };
    return {
      id: b.id,
      kind: b.kind,
      body: b.body,
      quoteKind: b.quoteKind,
      quoteId: b.quoteId,
      removed: false,
      quote: h.quote,
      sourceTitle: h.sourceTitle,
      sourceItemId: h.sourceItemId,
    };
  }
  for (const r of s.requests) {
    const e = r.evidence.find((x) => x.id === b.quoteId);
    if (e)
      return {
        id: b.id,
        kind: b.kind,
        body: b.body,
        quoteKind: b.quoteKind,
        quoteId: b.quoteId,
        removed: false,
        quote: e.quote,
        sourceTitle:
          s.sources.find((x) => x.id === e.sourceItemId)?.title ?? "",
        sourceItemId: e.sourceItemId,
        requestTitle: r.title,
      };
  }
  return {
    id: b.id,
    kind: b.kind,
    body: b.body,
    quoteKind: b.quoteKind,
    quoteId: b.quoteId,
    removed: true,
  };
}

on("GET", `${W}/findings`, ({ s, query }) => {
  const deleted = query.get("deleted") === "true";
  const q = (query.get("q") ?? "").trim().toLowerCase();
  return {
    documents: s.findings
      .filter((d) => (deleted ? d.deletedAt : !d.deletedAt))
      .filter(
        (d) =>
          !q ||
          d.title.toLowerCase().includes(q) ||
          d.blocks.some((b) => {
            const r = resolve(s, b);
            return (
              b.body.toLowerCase().includes(q) ||
              ("quote" in r && (r.quote as string).toLowerCase().includes(q))
            );
          }),
      )
      .map((d) => ({
        id: d.id,
        title: d.title,
        state: d.state,
        blocks: d.blocks.length,
        updatedAt: d.updatedAt,
        deletedAt: d.deletedAt,
      })),
  };
});
on("POST", `${W}/findings`, ({ s, body }) => {
  const d = {
    id: freshId(),
    title: String(body.title),
    state: "draft" as const,
    updatedAt: now(),
    blocks: [],
  };
  s.findings.unshift(d);
  return created({ id: d.id });
});
on("GET", `${W}/findings/{docId}`, ({ s, params }) => {
  const d = doc(s, params.docId);
  return {
    id: d.id,
    title: d.title,
    state: d.state,
    publicLink: d.state === "published" ? link(d.id) : undefined,
    publishedAt: d.publishedAt,
    updatedAt: d.updatedAt,
    shareExpiresAt: d.expiresAt,
    passwordProtected: Boolean(d.password),
    blocks: d.blocks.map((b) => resolve(s, b)),
  };
});
on("PUT", `${W}/findings/{docId}`, ({ s, params, body }) => {
  const d = doc(s, params.docId);
  d.title = String(body.title);
  d.updatedAt = now();
});
on("DELETE", `${W}/findings/{docId}`, ({ s, params }) => {
  const d = doc(s, params.docId);
  Object.assign(d, {
    deletedAt: now(),
    state: "draft",
    publishedAt: undefined,
    password: undefined,
    expiresAt: undefined,
  });
});
on("PUT", `${W}/findings/{docId}/blocks`, ({ s, params, body }) => {
  const d = doc(s, params.docId);
  // An existing card is kept as it is: the contract sends only its id and its note.
  const byId = new Map(d.blocks.map((b) => [b.id, b]));
  d.blocks = (
    body.blocks as {
      kind: "text" | "heading" | "quote";
      body?: string;
      id?: string;
      quoteKind?: "evidence" | "highlight";
      quoteId?: string;
    }[]
  ).map((b) => {
    const old = b.id ? byId.get(b.id) : undefined;
    return {
      id: b.id ?? freshId(),
      kind: b.kind,
      body: b.body ?? "",
      quoteKind: b.quoteKind ?? old?.quoteKind,
      quoteId: b.quoteId ?? old?.quoteId,
    };
  });
  d.updatedAt = now();
  snapshot(d);
});
on("POST", `${W}/findings/{docId}/blocks/quote`, ({ s, params, body }) => {
  const d = doc(s, params.docId);
  d.blocks.push({
    id: freshId(),
    kind: "quote",
    body: "",
    quoteKind: body.quoteKind,
    quoteId: body.quoteId,
  });
  d.updatedAt = now();
  snapshot(d);
});
on("POST", `${W}/findings/{docId}/duplicate`, ({ s, params }) => {
  const d = doc(s, params.docId);
  const title = `${d.title} (copy)`.slice(0, 200);
  const copy = {
    id: freshId(),
    title,
    state: "draft" as const,
    updatedAt: now(),
    blocks: d.blocks.map((b) => ({ ...b, id: freshId() })),
  };
  s.findings.unshift(copy);
  snapshot(copy);
  return created({ id: copy.id });
});
on("POST", `${W}/findings/{docId}/restore`, ({ s, params }) => {
  const d = s.findings.find((x) => x.id === params.docId);
  if (!d || !d.deletedAt) throw notFound("That document");
  d.deletedAt = undefined;
  d.updatedAt = now();
});
on("GET", `${W}/findings/{docId}/versions`, ({ s, params }) => {
  const d = doc(s, params.docId);
  return {
    versions: (d.versions ?? []).map((v) => ({
      id: v.id,
      title: v.title,
      blocks: v.blocks.length,
      createdAt: v.createdAt,
    })),
  };
});
on(
  "POST",
  `${W}/findings/{docId}/versions/{versionId}/restore`,
  ({ s, params }) => {
    const d = doc(s, params.docId);
    if (d.state === "published")
      throw new MockError(409, "conflict", "Take the link down first.");
    const v = (d.versions ?? []).find((x) => x.id === params.versionId);
    if (!v) throw notFound("That version");
    snapshot(d);
    d.title = v.title;
    d.blocks = clone(v.blocks);
    d.updatedAt = now();
    snapshot(d);
  },
);
on("POST", `${W}/findings/{docId}/publish`, ({ s, params, body }) => {
  const d = doc(s, params.docId);
  if (!body?.confirmed)
    throw new MockError(
      400,
      "invalid_request",
      "Confirm that you have read the document before sharing it.",
    );
  Object.assign(d, {
    state: "published",
    publishedAt: d.publishedAt ?? now(),
    expiresAt: body.expiresAt as string | undefined,
    password: body.password as string | undefined,
  });
  return {
    link: link(d.id),
    expiresAt: d.expiresAt,
  };
});
on("POST", `${W}/findings/{docId}/unpublish`, ({ s, params }) => {
  Object.assign(doc(s, params.docId), {
    state: "draft",
    publishedAt: undefined,
    password: undefined,
    expiresAt: undefined,
  });
});
on("POST", "/v1/public/findings/{token}/unlock", ({ s, params, body }) => {
  const d = s.findings.find(
    (x) => x.id === params.token && x.state === "published" && !x.deletedAt,
  );
  if (!d) throw new MockError(404, "not_found", "That page was not found.");
  if (!d.password)
    throw new MockError(400, "invalid_request", "This link has no password.");
  if (String(body.password) !== d.password)
    throw new MockError(401, "wrong_password", "That password does not match.");
  return {
    grant: `ok-${d.id}`,
    expiresAt: d.expiresAt ?? new Date(Date.now() + 8 * 3600_000).toISOString(),
  };
});
on("GET", "/v1/public/findings/{token}", ({ s, params, query }) => {
  const d = s.findings.find(
    (x) => x.id === params.token && x.state === "published" && !x.deletedAt,
  );
  if (!d) throw new MockError(404, "not_found", "That page was not found.");
  if (d.expiresAt && new Date(d.expiresAt).getTime() <= Date.now())
    throw new MockError(404, "not_found", "That page was not found.");
  if (d.password && query.get("grant") !== `ok-${d.id}`)
    throw new MockError(
      401,
      "password_required",
      "This link needs a password.",
    );
  return {
    title: d.title,
    publishedAt: d.publishedAt,
    expiresAt: d.expiresAt,
    blocks: d.blocks
      .map((b) => resolve(s, b))
      .filter((b) => !b.removed)
      .map((b) =>
        b.kind === "text" || b.kind === "heading"
          ? { kind: b.kind, text: b.body }
          : {
              kind: "quote" as const,
              text: "quote" in b ? (b.quote as string) : "",
              note: b.body || undefined,
            },
      ),
  };
});
