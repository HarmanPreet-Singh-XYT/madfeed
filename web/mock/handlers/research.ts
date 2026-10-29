import { on, created, MockError, notFound } from "../engine";
import { freshId } from "../ids";
import type { Store } from "../store";

// Tags, highlights, questions, spot checks and quotes: the research side of the workspace.

const W = "/v1/workspaces/{workspaceId}";
const now = () => new Date().toISOString();
const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();

const tagRef = (s: Store, id: string) => {
  const t = s.tags.find((x) => x.id === id);
  return t ? { id: t.id, name: t.name, color: t.color } : undefined;
};
const refs = (s: Store, ids: string[]) =>
  ids.flatMap((id) => tagRef(s, id) ?? []);
/** Keeps each tag's counts honest after tags are applied or removed. */
const recount = (s: Store) => {
  for (const t of s.tags) {
    t.requestCount = s.requests.filter((r) =>
      r.tags.some((x) => x.id === t.id),
    ).length;
    t.highlightCount = s.highlights.filter((h) =>
      h.tags.some((x) => x.id === t.id),
    ).length;
  }
};
const tag = (s: Store, id: string) => {
  const t = s.tags.find((x) => x.id === id);
  if (!t) throw notFound("That tag");
  return t;
};

// ---- tags
on("POST", `${W}/tags`, ({ s, body }) => {
  const name = String(body.name ?? "").trim();
  if (!name)
    throw new MockError(400, "invalid_request", "Give the tag a name.");
  if (
    s.tags.some(
      (t) => t.name.toLowerCase() === name.toLowerCase() && !t.archived,
    )
  )
    throw new MockError(
      409,
      "conflict",
      "A tag with that name already exists.",
    );
  const t = {
    id: freshId(),
    name,
    definition: String(body.definition ?? ""),
    color: body.color ?? "gray",
    origin: "human" as const,
    archived: false,
    highlightCount: 0,
    requestCount: 0,
  };
  s.tags.push(t);
  return created({ id: t.id });
});
on("PUT", `${W}/tags/{tagId}`, ({ s, params, body }) => {
  const t = tag(s, params.tagId);
  Object.assign(t, {
    name: String(body.name),
    definition: String(body.definition ?? t.definition),
    color: body.color ?? t.color,
  });
});
on(
  "POST",
  `${W}/tags/{tagId}/archive`,
  ({ s, params }) => void (tag(s, params.tagId).archived = true),
);
on(
  "POST",
  `${W}/tags/{tagId}/restore`,
  ({ s, params }) => void (tag(s, params.tagId).archived = false),
);
on("POST", `${W}/tags/{tagId}/merge`, ({ s, params, body }) => {
  const from = tag(s, params.tagId);
  const into = tag(s, body.intoTagId);
  const requestIds = s.requests
    .filter((r) => r.tags.some((x) => x.id === from.id))
    .map((r) => r.id);
  const highlightIds = s.highlights
    .filter((h) => h.tags.some((x) => x.id === from.id))
    .map((h) => h.id);
  const swap = (list: { id: string; name: string; color: string }[]) => {
    const rest = list.filter((x) => x.id !== from.id);
    return rest.some((x) => x.id === into.id)
      ? rest
      : [...rest, { id: into.id, name: into.name, color: into.color }];
  };
  for (const r of s.requests)
    if (requestIds.includes(r.id)) r.tags = swap(r.tags);
  for (const h of s.highlights)
    if (highlightIds.includes(h.id)) h.tags = swap(h.tags);
  const id = freshId();
  s.merges.push({ id, from: from.id, into: into.id, requestIds, highlightIds });
  Object.assign(from, { archived: true, mergedInto: into.id, undoMergeId: id });
  recount(s);
  return {
    mergeId: id,
    highlights: highlightIds.length,
    requests: requestIds.length,
  };
});
on("POST", `${W}/tag-merges/{mergeId}/undo`, ({ s, params }) => {
  const m = s.merges.find((x) => x.id === params.mergeId);
  if (!m) throw notFound("That merge");
  const from = tag(s, m.from);
  for (const r of s.requests)
    if (m.requestIds.includes(r.id))
      r.tags = [
        ...r.tags.filter((x) => x.id !== m.into || false),
        { id: from.id, name: from.name, color: from.color },
      ];
  for (const h of s.highlights)
    if (m.highlightIds.includes(h.id))
      h.tags = [...h.tags, { id: from.id, name: from.name, color: from.color }];
  Object.assign(from, {
    archived: false,
    mergedInto: undefined,
    undoMergeId: undefined,
  });
  s.merges = s.merges.filter((x) => x.id !== m.id);
  recount(s);
});
on("PUT", `${W}/requests/{requestId}/tags`, ({ s, params, body }) => {
  const r = s.requests.find((x) => x.id === params.requestId);
  if (!r) throw notFound("That request");
  r.tags = refs(s, body.tagIds as string[]);
  recount(s);
});

// ---- highlights
on("GET", `${W}/highlights`, ({ s, query }) => {
  const tagIds = query.getAll("tagIds");
  const src = query.get("sourceItemId");
  const untagged = query.get("untagged") === "true";
  const words = (query.get("q") ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const rows = s.highlights.filter(
    (h) =>
      (tagIds.length === 0 || h.tags.some((t) => tagIds.includes(t.id))) &&
      (!src || h.sourceItemId === src) &&
      (!untagged || h.tags.length === 0) &&
      (words.length === 0 ||
        words.every((w) => h.quote.toLowerCase().includes(w))),
  );
  return { highlights: rows, count: rows.length };
});
on("POST", `${W}/highlights/tags`, ({ s, body }) => {
  const tagIds = (body.tagIds as string[]) ?? [];
  const ids = (body.highlightIds as string[]) ?? [];
  for (const h of s.highlights) {
    if (!ids.includes(h.id)) continue;
    for (const id of tagIds) {
      const ref = tagRef(s, id);
      if (ref && !h.tags.some((t) => t.id === id)) h.tags.push(ref);
    }
  }
  recount(s);
});
on("POST", `${W}/highlights`, ({ s, body }) => {
  const source = s.sources.find((x) => x.id === body.sourceItemId);
  if (!source) throw notFound("That conversation");
  const h = {
    id: freshId(),
    sourceItemId: source.id,
    sourceTitle: source.title,
    spanStart: body.spanStart,
    spanEnd: body.spanEnd,
    quote: String(body.quote),
    note: String(body.note ?? ""),
    tags: refs(s, (body.tagIds as string[]) ?? []),
    createdAt: now(),
  };
  s.highlights.unshift(h);
  recount(s);
  return created(h);
});
on("DELETE", `${W}/highlights/{highlightId}`, ({ s, params }) => {
  s.highlights = s.highlights.filter((h) => h.id !== params.highlightId);
  recount(s);
});
on("PUT", `${W}/highlights/{highlightId}/tags`, ({ s, params, body }) => {
  const h = s.highlights.find((x) => x.id === params.highlightId);
  if (!h) throw notFound("That highlight");
  h.tags = refs(s, body.tagIds as string[]);
  recount(s);
});
on("GET", `${W}/sources/{sourceItemId}/highlight-suggestions`, () => ({
  suggestions: [],
}));

// ---- questions
on("GET", `${W}/qa`, ({ s }) => ({ answers: s.answers }));
on("GET", `${W}/qa/{answerId}`, ({ s, params }) => {
  const a = s.answers.find((x) => x.id === params.answerId);
  if (!a) throw notFound("That answer");
  return a;
});
on("POST", `${W}/qa`, ({ s, body }) => {
  const words = String(body.question ?? "")
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 4);
  const hit = s.requests
    .flatMap((r) => r.evidence)
    .find((e) => words.some((w) => e.quote.toLowerCase().includes(w)));
  const a = hit
    ? {
        id: freshId(),
        question: String(body.question),
        outcome: "answered" as const,
        reason: "",
        createdAt: now(),
        text: "Customers raised this [1].",
        citations: [
          {
            number: 1,
            kind: "evidence" as const,
            id: hit.id,
            sourceItemId: hit.sourceItemId,
            spanStart: hit.spanStart,
            spanEnd: hit.spanEnd,
            quote: hit.quote,
          },
        ],
      }
    : {
        id: freshId(),
        question: String(body.question),
        outcome: "no_evidence" as const,
        reason: "No stored quote speaks to this.",
        createdAt: now(),
        text: "",
        citations: [],
      };
  s.answers.unshift(a);
  return created(a);
});
on("PUT", `${W}/qa/{answerId}/rating`, ({ s, params, body }) => {
  const a = s.answers.find((x) => x.id === params.answerId);
  if (!a) throw notFound("That answer");
  a.rating = body.rating;
});

// ---- spot checks
on("GET", `${W}/audit`, ({ s }) => ({
  reviewed: s.audit.filter((a) => a.verdict).length + 10,
  supported: s.audit.filter((a) => a.verdict === "supported").length + 10,
  waiting: s.audit.filter((a) => !a.verdict).length,
  items: s.audit.map((a) => ({ ...a, gone: false })),
}));
on("PUT", `${W}/audit/{sampleId}`, ({ s, params, body }) => {
  const a = s.audit.find((x) => x.id === params.sampleId);
  if (!a) throw notFound("That sample");
  a.verdict = body.verdict;
  a.note = body.note;
});

// ---- quotes and feelings
const quoteRows = (s: Store) => {
  const sentiment = (id: string, text: string) => {
    const set = s.feelings[id];
    if (set) return { sentiment: set, sentimentSource: "human" as const };
    return {
      sentiment: (/harsh|forever|blocker|will not|bug/i.test(text)
        ? "negative"
        : /great|best|love/i.test(text)
          ? "positive"
          : "neutral") as "negative" | "positive" | "neutral",
      sentimentSource: "model" as const,
    };
  };
  const title = (id: string) => s.sources.find((x) => x.id === id)?.title ?? "";
  return [
    ...s.requests.flatMap((r) =>
      r.evidence.map((e) => ({
        kind: "evidence" as const,
        id: e.id,
        at: e.createdAt,
        text: e.quote,
        sourceItemId: e.sourceItemId,
        sourceTitle: title(e.sourceItemId),
        sourceKind: "paste",
        requestId: r.id,
        requestTitle: r.title,
        ...sentiment(e.id, e.quote),
        tags: r.tags,
      })),
    ),
    ...s.highlights.map((h) => ({
      kind: "highlight" as const,
      id: h.id,
      at: h.createdAt,
      text: h.quote,
      sourceItemId: h.sourceItemId,
      sourceTitle: h.sourceTitle,
      sourceKind: "paste",
      requestId: undefined,
      requestTitle: undefined,
      ...sentiment(h.id, h.quote),
      tags: h.tags,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));
};
on("GET", `${W}/quotes`, ({ s, query }) => {
  const q = (query.get("q") ?? "").toLowerCase();
  const tagId = query.get("tagId");
  const feeling = query.get("sentiment");
  const kind = query.get("kind");
  const source = query.get("sourceKind");
  const since = query.get("since");
  const before = query.get("before");
  const oldest = query.get("sort") === "oldest";
  let rows = quoteRows(s).filter(
    (x) =>
      (!q || x.text.toLowerCase().includes(q)) &&
      (!tagId || x.tags.some((t) => t.id === tagId)) &&
      (!feeling || x.sentiment === feeling) &&
      (!kind || x.kind === kind) &&
      (!source || x.sourceKind === source) &&
      (!since || x.at >= since) &&
      (!before || x.at < before),
  );
  rows = rows.sort((a, b) => (oldest ? a.at.localeCompare(b.at) : b.at.localeCompare(a.at)));
  const total = rows.length;
  const afterAt = query.get("afterAt");
  const afterId = query.get("afterId");
  if (afterAt && afterId) {
    rows = rows.filter((x) =>
      oldest
        ? x.at > afterAt || (x.at === afterAt && x.id > afterId)
        : x.at < afterAt || (x.at === afterAt && x.id < afterId),
    );
  }
  const limit = Math.min(Number(query.get("limit") ?? 50) || 50, 100);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    quotes: page,
    total,
    ...(rows.length > limit && last ? { next: { at: last.at, id: last.id } } : {}),
  };
});
on("GET", `${W}/quotes/{quoteKind}/{quoteId}`, ({ s, params }) => {
  const row = quoteRows(s).find((x) => x.kind === params.quoteKind && x.id === params.quoteId);
  if (!row) throw notFound("That quote");
  return row;
});
on("POST", `${W}/quotes/sentiment`, ({ s, body }) => {
  let updated = 0;
  for (const it of body.items ?? []) {
    if (body.label === "none") delete s.feelings[it.id];
    else s.feelings[it.id] = body.label;
    updated++;
  }
  return { updated, failed: 0 };
});
on("GET", `${W}/quotes/views`, () => ({ views: [] }));
on("POST", `${W}/quotes/views`, ({ body }) => ({
  id: freshId(),
  name: body.name,
  ...body,
  sort: body.sort ?? "newest",
  mine: true,
  createdAt: now(),
}));
on("DELETE", `${W}/quotes/views/{viewId}`, () => undefined);
on("PUT", `${W}/quotes/views/{viewId}`, ({ body, params }) => ({
  id: params.viewId,
  name: body.name,
  sort: "newest",
  mine: true,
  createdAt: now(),
}));
on("GET", `${W}/quotes/search`, ({ s, query }) => {
  const words = (query.get("q") ?? "")
    .toLowerCase()
    .split(/\W+/)
    .filter(Boolean);
  const hits = quoteRows(s)
    .map((x) => ({
      x,
      score:
        words.filter((w) => x.text.toLowerCase().includes(w)).length /
        Math.max(words.length, 1),
    }))
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ x, score }) => ({
      kind: x.kind,
      id: x.id,
      text: x.text,
      sourceItemId: x.sourceItemId,
      sourceTitle: x.sourceTitle,
      sourceKind: x.sourceKind,
      at: x.at,
      score,
    }));
  return { ready: true, pending: 0, hits };
});
on(
  "PUT",
  `${W}/quotes/{quoteKind}/{quoteId}/sentiment`,
  ({ s, params, body }) => {
    if (body.label === "none") delete s.feelings[params.quoteId];
    else s.feelings[params.quoteId] = body.label;
  },
);
on("GET", `${W}/sentiment`, ({ s }) => {
  const human = Object.keys(s.feelings).length;
  return {
    pending: 0,
    humanLabelled: 24 + human,
    compared: 24,
    agreed: 20,
    accuracy: 0.83,
    target: 0.8,
    enough: false,
    meetsTarget: true,
    pairs: [],
  };
});
on(
  "POST",
  `${W}/sentiment/classify`,
  () =>
    new Response(JSON.stringify({ pending: 0 }), {
      status: 202,
      headers: { "Content-Type": "application/json" },
    }),
);
on("GET", `${W}/sentiment/sample`, ({ s, query }) => {
  const rows = quoteRows(s)
    .filter((x) => !s.feelings[x.id])
    .slice(0, Number(query.get("limit") ?? 10));
  return {
    labelled: Object.keys(s.feelings).length,
    quotes: rows.map((x) => ({ kind: x.kind, id: x.id, text: x.text })),
  };
});
on("GET", `${W}/trends`, ({ s }) => ({
  tags: s.tags
    .filter((t) => !t.archived)
    .slice(0, 5)
    .map((t, i) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      total: 8 - i,
      byFeeling: {},
      weeks: [3, 2, 1, 0].map((w, k) => ({
        week: ago(w * 7).slice(0, 10),
        count: Math.max(0, 4 - i - (3 - k)),
      })),
    })),
}));

// ---- removing a conversation takes its quotes with it, as the real product does
on("DELETE", `${W}/sources/{sourceItemId}`, ({ s, params }) => {
  const id = params.sourceItemId;
  s.sources = s.sources.filter((x) => x.id !== id);
  s.proposals = s.proposals.filter((p) => p.sourceItemId !== id);
  s.highlights = s.highlights.filter((h) => h.sourceItemId !== id);
  for (const r of s.requests) {
    r.evidence = r.evidence.filter((e) => e.sourceItemId !== id);
    r.impact.evidenceCount = r.evidence.length;
  }
  s.requests = s.requests.filter(
    (r) => r.evidence.length > 0 || r.createdVia === "manual",
  );
  recount(s);
});
