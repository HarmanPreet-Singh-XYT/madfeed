import { on, MockError } from "../engine";

// The pages anyone can open: the public roadmap, release notes and voting.

const known = (slug: string, s: { settings: { publicSlug?: string } }) => {
  if (slug !== s.settings.publicSlug)
    throw new MockError(404, "not_found", "That page was not found.");
};

on("GET", "/v1/public/sites/{slug}/roadmap", ({ s, params }) => {
  known(params.slug, s);
  return {
    workspaceName: s.workspace.name,
    items: s.requests
      .filter((r) => r.public && r.status.bucket !== "closed")
      .map((r) => ({
        id: r.id,
        title: r.publicTitle || r.title,
        summary: r.publicSummary,
        status: r.status.name,
        bucket: r.status.bucket as "open" | "active" | "done",
        votes: r.voteCount + (s.votes.has(r.id) ? 1 : 0),
        verifiedVotes: r.verifiedVoteCount,
      })),
  };
});
on("GET", "/v1/sites/{slug}/votes", ({ s, params }) => {
  known(params.slug, s);
  return { verified: true, requestIds: [...s.votes] };
});
on(
  "PUT",
  "/v1/sites/{slug}/requests/{requestId}/vote",
  ({ s, params }) => void s.votes.add(params.requestId),
);
on(
  "DELETE",
  "/v1/sites/{slug}/requests/{requestId}/vote",
  ({ s, params }) => void s.votes.delete(params.requestId),
);
on("DELETE", "/v1/votes", ({ s }) => {
  const removed = s.votes.size;
  s.votes.clear();
  return { removed };
});

on("GET", "/v1/public/releases/{slug}", ({ s, params }) => {
  known(params.slug, s);
  return {
    workspaceName: s.workspace.name,
    notes: s.notes
      .filter((n) => n.liveNow && n.publishedAt)
      .map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        publishedAt: n.publishedAt!,
      })),
  };
});
on("GET", "/v1/public/releases/{slug}/{noteId}", ({ s, params }) => {
  known(params.slug, s);
  const n = s.notes.find(
    (x) => x.id === params.noteId && x.liveNow && x.publishedAt,
  );
  if (!n)
    throw new MockError(404, "not_found", "That release note was not found.");
  return {
    workspaceName: s.workspace.name,
    note: {
      id: n.id,
      title: n.title,
      body: n.body,
      publishedAt: n.publishedAt!,
    },
  };
});

// ---- the website feedback form: the message lands in the review queue, as it does for real
on("POST", "/v1/public/sites/{slug}/feedback", ({ s, params, body }) => {
  known(params.slug, s);
  if (body.key !== s.form.key)
    throw new MockError(404, "not_found", "That form was not found.");
  const text = String(body.text ?? "").trim();
  if (!text)
    throw new MockError(400, "invalid_request", "Write a message first.");
  const id = crypto.randomUUID();
  s.sources.unshift({
    id,
    kind: "paste",
    redactions: 0,
    title: "Website feedback",
    state: "done",
    createdAt: new Date().toISOString(),
    text,
  });
  s.proposals.unshift({
    id: crypto.randomUUID(),
    sourceItemId: id,
    kind: "new_request",
    statementKind: "need",
    title: text.split(/\s+/).slice(0, 7).join(" "),
    quote: text,
    spanStart: 0,
    spanEnd: new TextEncoder().encode(text).length,
    confidence: 0.8,
    state: "suggested",
    createdAt: new Date().toISOString(),
  });
  return new Response(JSON.stringify({ received: true }), {
    status: 202,
    headers: { "Content-Type": "application/json" },
  });
});

// ---- voting from a link signed by the company's own app (the sample accepts any well-formed link)
on("POST", "/v1/public/sites/{slug}/signed/votes", ({ s, params }) => {
  known(params.slug, s);
  return { requestIds: [...s.votes] };
});
on(
  "POST",
  "/v1/public/sites/{slug}/requests/{requestId}/signed-vote",
  ({ s, params, body }) => {
    known(params.slug, s);
    if (body.remove) s.votes.delete(params.requestId);
    else s.votes.add(params.requestId);
  },
);

// ---- unsubscribing from emails
for (const kind of ["unsubscribe", "digest/unsubscribe"]) {
  on("GET", `/v1/public/${kind}/{token}`, () => ({
    maskedEmail: "d***@harbor.example",
  }));
  on("POST", `/v1/public/${kind}/{token}`, () => undefined);
}
