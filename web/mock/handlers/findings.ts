import { on, created, MockError, notFound } from "../engine";
import { freshId } from "../ids";
import type { Store } from "../store";

// Findings documents: text and quote cards that can be shared by a link.

const W = "/v1/workspaces/{workspaceId}";
const now = () => new Date().toISOString();
const link = (id: string) => `http://localhost:3100/f/${id}`;

const doc = (s: Store, id: string) => {
  const d = s.findings.find((x) => x.id === id);
  if (!d) throw notFound("That document");
  return d;
};

/** Looks up the words, the conversation and the request behind a quote card. A card whose quote is gone says so. */
function resolve(s: Store, b: Store["findings"][number]["blocks"][number]) {
  if (b.kind === "text")
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

on("GET", `${W}/findings`, ({ s }) => ({
  documents: s.findings.map((d) => ({
    id: d.id,
    title: d.title,
    state: d.state,
    blocks: d.blocks.length,
    updatedAt: d.updatedAt,
  })),
}));
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
    blocks: d.blocks.map((b) => resolve(s, b)),
  };
});
on("PUT", `${W}/findings/{docId}`, ({ s, params, body }) => {
  const d = doc(s, params.docId);
  d.title = String(body.title);
  d.updatedAt = now();
});
on("DELETE", `${W}/findings/{docId}`, ({ s, params }) => {
  doc(s, params.docId);
  s.findings = s.findings.filter((x) => x.id !== params.docId);
});
on("PUT", `${W}/findings/{docId}/blocks`, ({ s, params, body }) => {
  const d = doc(s, params.docId);
  d.blocks = (
    body.blocks as {
      kind: "text" | "quote";
      body?: string;
      id?: string;
      quoteKind?: "evidence" | "highlight";
      quoteId?: string;
    }[]
  ).map((b) => ({
    id: b.id ?? freshId(),
    kind: b.kind,
    body: b.body ?? "",
    quoteKind: b.quoteKind,
    quoteId: b.quoteId,
  }));
  d.updatedAt = now();
});
on("POST", `${W}/findings/{docId}/publish`, ({ s, params, body }) => {
  const d = doc(s, params.docId);
  if (!body?.confirmed)
    throw new MockError(
      400,
      "invalid_request",
      "Confirm that you have read the document before sharing it.",
    );
  Object.assign(d, { state: "published", publishedAt: now() });
  return { link: link(d.id) };
});
on("POST", `${W}/findings/{docId}/unpublish`, ({ s, params }) => {
  Object.assign(doc(s, params.docId), {
    state: "draft",
    publishedAt: undefined,
  });
});
on("GET", "/v1/public/findings/{token}", ({ s, params }) => {
  const d = s.findings.find(
    (x) => x.id === params.token && x.state === "published",
  );
  if (!d) throw new MockError(404, "not_found", "That page was not found.");
  return {
    title: d.title,
    publishedAt: d.publishedAt,
    blocks: d.blocks
      .map((b) => resolve(s, b))
      .filter((b) => !b.removed)
      .map((b) =>
        b.kind === "text"
          ? { kind: "text" as const, text: b.body }
          : {
              kind: "quote" as const,
              text: "quote" in b ? (b.quote as string) : "",
              note: b.body || undefined,
            },
      ),
  };
});
