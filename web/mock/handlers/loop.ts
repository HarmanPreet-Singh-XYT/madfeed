import { on, created, MockError, notFound } from "../engine";
import { freshId } from "../ids";
import { COVER_PNG, COVER_TYPE } from "../cover";
import type { Store } from "../store";

const W = "/v1/workspaces/{workspaceId}";
const now = () => new Date().toISOString();

// ---- messages to the people who asked
on("GET", `${W}/outreach`, ({ s, query }) => {
  const state = query.get("state");
  const rows = s.batches
    // "open" is the Messages tab for work in progress: drafting, waiting for review, or being sent.
    .filter((b) =>
      !state || state === "open"
        ? ["drafting", "review", "approved"].includes(b.state)
        : b.state === state,
    )
    .map((b) => ({
      id: b.id,
      requestId: b.requestId,
      requestTitle: b.requestTitle,
      state: b.state,
      messageCount: b.messages.length,
      readyToSend: b.messages.filter((m) => m.state === "draft").length,
      leftOut: b.messages.filter(
        (m) => m.state === "excluded" || m.state === "suppressed",
      ).length,
      failed: b.messages.filter((m) => m.state === "failed").length,
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
on("POST", `${W}/outreach/messages/{messageId}/test`, ({ s, params }) => {
  const m = message(s, params.messageId);
  if (m.state !== "draft")
    throw new MockError(409, "conflict", "That message is not a draft.");
});

// ---- release notes
const note = (s: Store, id: string) => {
  const n = s.notes.find((x) => x.id === id);
  if (!n) throw notFound("That release note");
  return n;
};
const noteCounts = (s: Store) => ({
  all: s.notes.length,
  draft: s.notes.filter((n) => n.state === "draft").length,
  scheduled: s.notes.filter((n) => n.state === "scheduled").length,
  published: s.notes.filter((n) => n.state === "published").length,
  unpublished: s.notes.filter((n) => n.state === "unpublished").length,
});

on("GET", `${W}/release-notes`, ({ s, query }) => {
  const state = query.get("state");
  const q = (query.get("q") ?? "").trim().toLowerCase();
  const type = query.get("type");
  const notes = s.notes.filter(
    (n) =>
      (!state || n.state === state) &&
      (!type || n.type === type) &&
      (!q || n.title.toLowerCase().includes(q)),
  );
  return { notes, counts: noteCounts(s) };
});
on("PUT", `${W}/release-notes/{noteId}/cover`, ({ s, params, uploadedBytes }) => {
  const n = note(s, params.noteId);
  if (!uploadedBytes)
    throw new MockError(400, "bad_request", "The picture is empty.");
  s.covers[n.id] = COVER_TYPE;
  n.coverUpdatedAt = now();
});
on("GET", `${W}/release-notes/{noteId}/cover`, ({ s, params }) => {
  const n = note(s, params.noteId);
  if (!s.covers[n.id]) throw notFound("That cover");
  return new Response(COVER_PNG, {
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
});
on("DELETE", `${W}/release-notes/{noteId}/cover`, ({ s, params }) => {
  const n = note(s, params.noteId);
  if (!s.covers[n.id]) throw notFound("That cover");
  delete s.covers[n.id];
  n.coverUpdatedAt = undefined;
});

on("GET", `${W}/release-notes/{noteId}`, ({ s, params }) =>
  note(s, params.noteId),
);
on("POST", `${W}/release-notes/{noteId}/duplicate`, ({ s, params }) => {
  const src = note(s, params.noteId);
  const title =
    src.title.length > 193 ? `${src.title.slice(0, 193)} (copy)` : `${src.title} (copy)`;
  const n = {
    id: freshId(),
    title,
    body: src.body,
    type: src.type,
    state: "draft" as const,
    liveNow: false,
    requests: src.requests.map((r) => ({ ...r })),
    createdAt: now(),
    updatedAt: now(),
  };
  s.notes.unshift(n);
  return created({ id: n.id });
});
on("DELETE", `${W}/release-notes/{noteId}`, ({ s, params }) => {
  const n = note(s, params.noteId);
  if (n.state !== "draft")
    throw new MockError(
      409,
      "conflict",
      "A note that has been public can be taken down but not deleted.",
    );
  s.notes = s.notes.filter((x) => x.id !== n.id);
});
on("POST", `${W}/release-notes`, ({ s, body }) => {
  const n = {
    id: freshId(),
    title: String(body.title),
    body: String(body.body ?? ""),
    type: (body.type as "new" | "improved" | "fixed" | undefined) ?? "new",
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
    ...(body.type ? { type: body.type as "new" | "improved" | "fixed" } : {}),
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
on("POST", `${W}/release-notes/{noteId}/publish`, ({ s, params, body }) => {
  const n = note(s, params.noteId);
  const at = (body as { scheduledFor?: string } | undefined)?.scheduledFor;
  if (at) {
    // Scheduled: public at that instant, not before.
    Object.assign(n, {
      state: "scheduled",
      scheduledFor: at,
      liveNow: false,
      publishedAt: undefined,
    });
    return;
  }
  Object.assign(n, {
    state: "published",
    liveNow: true,
    publishedAt: now(),
    scheduledFor: undefined,
  });
});
on("POST", `${W}/release-notes/{noteId}/unschedule`, ({ s, params }) => {
  const n = note(s, params.noteId);
  if (n.state !== "scheduled")
    throw new MockError(409, "conflict", "This note is not scheduled.");
  Object.assign(n, { state: "draft", scheduledFor: undefined });
});
on("POST", `${W}/release-notes/{noteId}/unpublish`, ({ s, params }) => {
  Object.assign(note(s, params.noteId), {
    state: "unpublished",
    liveNow: false,
  });
});
