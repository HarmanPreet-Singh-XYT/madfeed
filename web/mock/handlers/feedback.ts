import { on, created, MockError, noContent, notFound } from "../engine";
import { freshId } from "../ids";
import type { Store } from "../store";

const W = "/v1/workspaces/{workspaceId}";
const now = () => new Date().toISOString();

const summary = (r: Store["requests"][number]) => ({
  id: r.id,
  title: r.title,
  createdVia: r.createdVia,
  createdAt: r.createdAt,
  status: r.status,
  impact: r.impact,
  tags: r.tags,
  roadmapPosition: r.roadmapPosition ?? null,
});
const find = (s: Store, id: string) => {
  const r = s.requests.find((x) => x.id === id);
  if (!r) throw notFound("That request");
  return r;
};

// ---- requests
on("GET", `${W}/requests`, ({ s, query }) => {
  const q = (query.get("q") ?? "").toLowerCase();
  const status = query.get("statusId");
  const tag = query.get("tagId");
  let list = s.requests.filter(
    (r) =>
      (!q || r.title.toLowerCase().includes(q)) &&
      (!status || r.status.id === status) &&
      (!tag || r.tags.some((t) => t.id === tag)),
  );
  if (query.get("sort") === "value")
    list = [...list].sort(
      (a, b) => Number(b.impact.totalValue) - Number(a.impact.totalValue),
    );
  else list = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const limit = Number(query.get("limit") ?? 50);
  return { requests: list.slice(0, limit).map(summary) };
});
on("GET", `${W}/requests/{requestId}`, ({ s, params }) =>
  find(s, params.requestId),
);

on("PATCH", `${W}/requests/{requestId}`, ({ s, params, body }) => {
  const r = find(s, params.requestId);
  r.title = String(body.title);
  return noContent();
});
on("DELETE", `${W}/requests/{requestId}`, ({ s, params }) => {
  const i = s.requests.findIndex((x) => x.id === params.requestId);
  if (i < 0) throw notFound("That request");
  s.requests.splice(i, 1);
  return noContent();
});

on("PUT", `${W}/roadmap/order`, ({ s, body }) => {
  const ids = (body.ids ?? []) as string[];
  ids.forEach((id, i) => {
    const r = s.requests.find((x) => x.id === id);
    if (r) r.roadmapPosition = i;
  });
  return noContent();
});

on("PUT", `${W}/requests/{requestId}/status`, ({ s, params, body }) => {
  const r = find(s, params.requestId);
  const st = s.statuses.find((x) => x.id === body.statusId);
  if (!st)
    throw new MockError(400, "invalid_request", "That status does not exist.");
  const wasDone = r.status.bucket === "done";
  r.status = { id: st.id, name: st.name, bucket: st.bucket };
  const out = {
    shipped: false,
    willContact: 0,
    suppressed: 0,
    noEmail: 0,
    anonymousQuotes: 0,
  } as Record<string, unknown>;
  if (st.bucket === "done" && !wasDone && !r.openBatchId) {
    // Shipping starts personal drafts for the people who asked; nothing is sent until a person approves.
    const to = s.people.filter((p) => p.email).slice(0, 2);
    const batch = {
      id: freshId(),
      requestId: r.id,
      requestTitle: r.title,
      state: "review" as const,
      createdAt: now(),
      noEmail: 0,
      anonymousQuotes: 0,
      readyToSend: 0,
      messages: to.map((p) => ({
        id: freshId(),
        personId: p.id,
        personName: p.name,
        accountName: p.accountName,
        toEmail: p.email!,
        state: "draft" as const,
        subject: `${r.title}: it's here`,
        edited: false,
        draftedBy: "model" as const,
        body: `Hi ${p.name.split(" ")[0]},\n\nYou told us about "${r.title}". It has shipped.\n\nThank you for the nudge.\n\nThe Northwind team`,
        quotes: r.evidence
          .slice(0, 1)
          .map((e) => ({ evidenceId: e.id, text: e.quote })),
      })),
    };
    s.batches.unshift(batch as Store["batches"][number]);
    r.openBatchId = batch.id;
    Object.assign(out, {
      shipped: true,
      batchId: batch.id,
      willContact: to.length,
    });
  }
  return out;
});
on("PUT", `${W}/requests/{requestId}/public`, ({ s, params, body }) => {
  const r = find(s, params.requestId);
  r.public = Boolean(body.public);
  if (typeof body.title === "string") r.publicTitle = body.title;
  if (typeof body.summary === "string") r.publicSummary = body.summary;
});
on("GET", `${W}/requests/{requestId}/brief`, ({ s, params }) => {
  const b = s.briefs[params.requestId];
  if (!b) throw notFound("A brief");
  return b;
});
on("POST", `${W}/requests/{requestId}/brief`, ({ s, params }) => {
  const r = find(s, params.requestId);
  return (s.briefs[r.id] ??= {
    state: "ready",
    stale: false,
    lowEvidence: r.evidence.length < 3,
    claim: `${r.impact.peopleCount} ${r.impact.peopleCount === 1 ? "person asks" : "people ask"} for this.`,
    disproof: "There is too little evidence to say how many others want it.",
    quotes: r.evidence.map((e) => ({
      evidenceId: e.id,
      sourceItemId: e.sourceItemId,
      quote: e.quote,
      spanStart: e.spanStart,
      spanEnd: e.spanEnd,
    })),
    generatedAt: now(),
    facts: {
      evidenceCount: r.evidence.length,
      newLast30Days: r.evidence.length,
      unidentifiedQuotes: 0,
      peopleCount: r.impact.peopleCount,
      accountCount: r.impact.accountCount,
      accountsWithValue: r.impact.accountsWithValue,
      totalValue: r.impact.totalValue,
      accounts: [],
    },
  });
});

// ---- sources and the review queue
on("GET", `${W}/sources/{sourceItemId}`, ({ s, params }) => {
  const src = s.sources.find((x) => x.id === params.sourceItemId);
  if (!src) throw notFound("That conversation");
  return src;
});
on("POST", `${W}/sources/paste`, ({ s, body }) => {
  const text = String(body.text ?? "");
  const id = freshId();
  s.sources.unshift({
    id,
    kind: "paste",
    redactions: 0,
    title: String(
      body.title || text.split("\n")[0].slice(0, 60) || "Pasted conversation",
    ),
    state: "done",
    createdAt: now(),
    text,
  });
  // Stand-in for the reading step: every line that sounds like a wish becomes a suggestion for review.
  const enc = new TextEncoder();
  let offset = 0;
  for (const line of text.split("\n")) {
    const start = enc.encode(text.slice(0, text.indexOf(line, offset))).length;
    offset = text.indexOf(line, offset) + line.length;
    if (
      /\b(need|want|wish|would like|please|cannot|can't|broken|bug)\b/i.test(
        line,
      ) &&
      line.length > 30
    )
      s.proposals.unshift({
        id: freshId(),
        sourceItemId: id,
        kind: "new_request",
        statementKind: "need",
        title: line
          .replace(/^[A-Za-z ]+:\s*/, "")
          .split(/\s+/)
          .slice(0, 7)
          .join(" "),
        quote: line,
        spanStart: start,
        spanEnd: start + enc.encode(line).length,
        confidence: 0.8,
        state: "suggested",
        createdAt: now(),
      });
  }
  return created({ sourceItemId: id, duplicate: false });
});
on("GET", `${W}/proposals`, ({ s, query }) => {
  const state = query.get("state") ?? "suggested";
  return {
    proposals: s.proposals
      .filter((p) => p.state === state)
      .slice(0, Number(query.get("limit") ?? 100)),
  };
});
const proposal = (s: Store, id: string) => {
  const p = s.proposals.find((x) => x.id === id);
  if (!p) throw notFound("That suggestion");
  return p;
};
on("POST", `${W}/proposals/{proposalId}/accept`, ({ s, params }) => {
  const p = proposal(s, params.proposalId);
  const evidence = {
    id: freshId(),
    sourceItemId: p.sourceItemId,
    quote: p.quote,
    spanStart: p.spanStart,
    spanEnd: p.spanEnd,
    confidence: p.confidence,
    createdAt: now(),
  };
  let req = p.suggestion
    ? s.requests.find((r) => r.id === p.suggestion!.requestId)
    : undefined;
  if (!req) {
    req = {
      id: freshId(),
      title: p.title,
      createdVia: "machine",
      createdAt: now(),
      status: {
        id: s.statuses[0].id,
        name: s.statuses[0].name,
        bucket: s.statuses[0].bucket,
      },
      tags: [],
      public: false,
      publicTitle: "",
      publicSummary: "",
      voteCount: 0,
      verifiedVoteCount: 0,
      verifiedVoters: [],
      informed: [],
      releaseNotes: [],
      impact: {
        evidenceCount: 0,
        peopleCount: 0,
        accountCount: 0,
        totalValue: "0",
        accountsWithValue: 0,
      },
      evidence: [],
    };
    s.requests.unshift(req);
  }
  req.evidence.push(evidence);
  req.impact.evidenceCount = req.evidence.length;
  p.state = "accepted";
  p.requestId = req.id;
  return { requestId: req.id, evidenceId: evidence.id };
});
on("POST", `${W}/proposals/{proposalId}/dismiss`, ({ s, params }) => {
  proposal(s, params.proposalId).state = "dismissed";
});
on("POST", `${W}/proposals/{proposalId}/undo`, ({ s, params }) => {
  const p = proposal(s, params.proposalId);
  if (p.requestId) {
    const r = s.requests.find((x) => x.id === p.requestId);
    if (r) {
      r.evidence = r.evidence.filter(
        (e) =>
          !(e.sourceItemId === p.sourceItemId && e.spanStart === p.spanStart),
      );
      r.impact.evidenceCount = r.evidence.length;
      if (r.evidence.length === 0 && r.createdVia === "machine")
        s.requests = s.requests.filter((x) => x.id !== r.id);
    }
  }
  p.state = "suggested";
  p.requestId = undefined;
});
on("PATCH", `${W}/proposals/{proposalId}`, ({ s, params, body }) => {
  proposal(s, params.proposalId).title = String(body.title);
});
on("POST", `${W}/proposals/bulk-accept`, ({ s, body }) => {
  const todo = s.proposals.filter(
    (p) =>
      p.state === "suggested" &&
      p.kind === "new_request" &&
      p.confidence >= Number(body.threshold ?? 0.9),
  );
  return {
    accepted: todo.length,
    skipped:
      s.proposals.filter((p) => p.state === "suggested").length - todo.length,
  };
});

void created;
