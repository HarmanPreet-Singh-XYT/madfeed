import { on, created, MockError, notFound } from "../engine";
import { freshId } from "../ids";
import type { Store } from "../store";

const W = "/v1/workspaces/{workspaceId}";
const now = () => new Date().toISOString();

// ---- messages to the people who asked
on("GET", `${W}/outreach`, ({ s, query }) => {
  const state = query.get("state");
  const rows = s.batches
    .filter((b) => !state || b.state === state)
    .map((b) => ({
      id: b.id,
      requestId: b.requestId,
      requestTitle: b.requestTitle,
      state: b.state,
      messageCount: b.messages.length,
      createdAt: b.createdAt,
    }));
  return { batches: rows };
});
const batch = (s: Store, id: string) => {
  const b = s.batches.find((x) => x.id === id);
  if (!b) throw notFound("That batch");
  return b;
};
on("GET", `${W}/outreach/{batchId}`, ({ s, params }) => {
  const b = batch(s, params.batchId);
  return {
    ...b,
    readyToSend: b.messages.filter((m) => m.state === "draft").length,
  };
});
on("POST", `${W}/outreach/{batchId}/approve`, ({ s, params }) => {
  const b = batch(s, params.batchId);
  const drafts = b.messages.filter((m) => m.state === "draft");
  if (drafts.length === 0)
    throw new MockError(409, "nothing_to_send", "There is nothing to send.");
  // The sample build sends nothing; approved messages just show as sent.
  for (const m of drafts) Object.assign(m, { state: "sent", sentAt: now() });
  b.state = "done";
  const r = s.requests.find((x) => x.id === b.requestId);
  if (r) {
    r.openBatchId = undefined;
    r.informed = drafts.map((m) => ({
      personId: m.personId,
      name: m.personName,
      sentAt: now(),
    }));
  }
  return { queued: drafts.length };
});
on("POST", `${W}/outreach/{batchId}/cancel`, ({ s, params }) => {
  const b = batch(s, params.batchId);
  b.state = "cancelled";
  const r = s.requests.find((x) => x.id === b.requestId);
  if (r) r.openBatchId = undefined;
});
const message = (s: Store, id: string) => {
  for (const b of s.batches) {
    const m = b.messages.find((x) => x.id === id);
    if (m) return m;
  }
  throw notFound("That message");
};
on("PUT", `${W}/outreach/messages/{messageId}`, ({ s, params, body }) => {
  const m = message(s, params.messageId);
  Object.assign(m, {
    subject: String(body.subject),
    body: String(body.body),
    edited: true,
  });
});
on(
  "POST",
  `${W}/outreach/messages/{messageId}/exclude`,
  ({ s, params }) => void (message(s, params.messageId).state = "excluded"),
);
on(
  "POST",
  `${W}/outreach/messages/{messageId}/include`,
  ({ s, params }) => void (message(s, params.messageId).state = "draft"),
);
on(
  "POST",
  `${W}/outreach/messages/{messageId}/retry`,
  ({ s, params }) => void (message(s, params.messageId).state = "approved"),
);

// ---- release notes
const note = (s: Store, id: string) => {
  const n = s.notes.find((x) => x.id === id);
  if (!n) throw notFound("That release note");
  return n;
};
on("GET", `${W}/release-notes`, ({ s }) => ({ notes: s.notes }));
on("GET", `${W}/release-notes/{noteId}`, ({ s, params }) =>
  note(s, params.noteId),
);
on("POST", `${W}/release-notes`, ({ s, body }) => {
  const n = {
    id: freshId(),
    title: String(body.title),
    body: String(body.body ?? ""),
    state: "draft" as const,
    liveNow: false,
    requests: [],
    createdAt: now(),
    updatedAt: now(),
  };
  s.notes.unshift(n);
  return created({ id: n.id });
});
on("PUT", `${W}/release-notes/{noteId}`, ({ s, params, body }) => {
  const n = note(s, params.noteId);
  Object.assign(n, {
    title: String(body.title),
    body: String(body.body ?? ""),
    updatedAt: now(),
  });
});
on("PUT", `${W}/release-notes/{noteId}/requests`, ({ s, params, body }) => {
  const n = note(s, params.noteId);
  n.requests = (body.requestIds as string[]).flatMap((id) => {
    const r = s.requests.find((x) => x.id === id);
    return r ? [{ id: r.id, title: r.title }] : [];
  });
});
on("POST", `${W}/release-notes/{noteId}/publish`, ({ s, params }) => {
  const n = note(s, params.noteId);
  Object.assign(n, {
    state: "published",
    liveNow: true,
    publishedAt: now(),
    scheduledFor: undefined,
  });
});
on("POST", `${W}/release-notes/{noteId}/unpublish`, ({ s, params }) => {
  Object.assign(note(s, params.noteId), {
    state: "unpublished",
    liveNow: false,
  });
});
