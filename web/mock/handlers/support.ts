import { on, created, MockError, notFound } from "../engine";
import { freshId } from "../ids";
import type { Store } from "../store";

// The shared inbox for website chat and email, and the chat window visitors see.

const W = "/v1/workspaces/{workspaceId}";
const ME = "00000000-0000-4000-8000-0000000000a1";
const now = () => new Date().toISOString();

type Conv = Store["conversations"][number];
const conv = (s: Store, id: string): Conv => {
  const c = s.conversations.find((x) => x.id === id);
  if (!c) throw notFound("That conversation");
  return c;
};
const lastTalk = (c: Conv) =>
  c.thread.filter((m) => m.direction !== "note").at(-1);
const summary = (c: Conv) => ({
  id: c.id,
  assignedToMe: c.assignee === ME,
  channel: c.channel,
  state: c.state,
  subject: c.subject,
  customerName: c.customerName,
  customerEmail: c.customerEmail,
  personId: c.personId,
  assignee: c.assignee,
  preview: lastTalk(c)?.body.slice(0, 90) ?? "",
  messages: c.thread.filter((m) => m.direction !== "note").length,
  lastMessageAt: c.thread.at(-1)?.at ?? now(),
  awaitingReply: lastTalk(c)?.direction === "in",
  unread: (c.thread.at(-1)?.seq ?? 0) > (c.readSeq ?? 0),
});
const next = (c: Conv) => (c.thread.at(-1)?.seq ?? 0) + 1;

on("GET", `${W}/conversations`, ({ s, query }) => {
  const state = query.get("state");
  const q = (query.get("q") ?? "").toLowerCase();
  const channel = query.get("channel");
  const assignee = query.get("assignee");
  const list = s.conversations.filter(
    (c) =>
      (!state || c.state === state) &&
      (query.get("mine") !== "true" || c.assignee === ME) &&
      (query.get("unassigned") !== "true" || !c.assignee) &&
      (!channel || c.channel === channel) &&
      (!assignee || c.assignee === assignee) &&
      (query.get("unread") !== "true" ||
        (c.thread.at(-1)?.seq ?? 0) > (c.readSeq ?? 0)) &&
      (!q ||
        c.customerName.toLowerCase().includes(q) ||
        c.customerEmail.toLowerCase().includes(q) ||
        c.subject.toLowerCase().includes(q) ||
        (lastTalk(c)?.body ?? "").toLowerCase().includes(q)),
  );
  return {
    conversations: list
      .map(summary)
      .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt)),
  };
});
on("POST", `${W}/conversations/{conversationId}/read`, ({ s, params }) => {
  const c = conv(s, params.conversationId);
  c.readSeq = c.thread.at(-1)?.seq ?? c.readSeq ?? 0;
});
on("POST", `${W}/conversations/bulk`, ({ s, body }) => {
  const ids = (body.conversationIds as string[]) ?? [];
  let updated = 0;
  for (const c of s.conversations) {
    if (!ids.includes(c.id)) continue;
    if (body.action === "take") c.assignee = ME;
    else if (body.action === "release") c.assignee = undefined;
    else if (body.action === "close") c.state = "closed";
    else if (body.action === "reopen") c.state = "open";
    updated += 1;
  }
  return { updated };
});
on("GET", `${W}/conversations/{conversationId}`, ({ s, params }) => {
  const c = conv(s, params.conversationId);
  return {
    ...summary(c),
    lastMessageId: c.thread.at(-1)!.id,
    canReply: true,
    thread: c.thread,
    cards: c.cards,
  };
});
on("DELETE", `${W}/conversations/{conversationId}`, ({ s, params }) => {
  conv(s, params.conversationId);
  s.conversations = s.conversations.filter(
    (c) => c.id !== params.conversationId,
  );
});
on(
  "POST",
  `${W}/conversations/{conversationId}/reply`,
  ({ s, params, body }) => {
    const c = conv(s, params.conversationId);
    if (c.thread.at(-1)?.id !== body.seenMessageId)
      throw new MockError(
        409,
        "newer_message",
        "A new message arrived while you were writing. Read it, then send your reply.",
      );
    const m = {
      id: freshId(),
      seq: next(c),
      direction: "out" as const,
      body: String(body.body),
      authorId: ME,
      state: "sent",
      at: now(),
      sentOn: false,
      files: [],
    };
    c.thread.push(m);
    return created({ messageId: m.id });
  },
);
on(
  "POST",
  `${W}/conversations/{conversationId}/notes`,
  ({ s, params, body }) => {
    const c = conv(s, params.conversationId);
    const m = {
      id: freshId(),
      seq: next(c),
      direction: "note" as const,
      body: String(body.body),
      authorId: ME,
      state: "sent",
      at: now(),
      sentOn: false,
      files: [],
    };
    c.thread.push(m);
    return created({ messageId: m.id });
  },
);
on(
  "PUT",
  `${W}/conversations/{conversationId}/assignee`,
  ({ s, params, body }) => {
    const c = conv(s, params.conversationId);
    if (
      body.expectedAssignee !== undefined &&
      body.expectedAssignee !== c.assignee
    )
      throw new MockError(
        409,
        "taken",
        "Someone else already took this conversation.",
      );
    c.assignee = body.take ? ME : (body.assignTo ?? undefined);
  },
);
on(
  "PUT",
  `${W}/conversations/{conversationId}/state`,
  ({ s, params, body }) =>
    void (conv(s, params.conversationId).state = body.state),
);
on(
  "POST",
  `${W}/conversations/{conversationId}/messages/{messageId}/convert`,
  ({ s, params }) => {
    const c = conv(s, params.conversationId);
    const m = c.thread.find((x) => x.id === params.messageId);
    if (!m || m.direction !== "in") throw notFound("That message");
    const id = freshId();
    s.sources.unshift({
      id,
      kind: "paste",
      redactions: 0,
      title: `Support: ${c.subject}`,
      state: "done",
      createdAt: now(),
      text: m.body,
    });
    m.sentOn = true;
    c.cards.push({
      messageId: m.id,
      sourceItemId: id,
      stage: "processing",
      waiting: 0,
      requests: [],
    });
    return { sourceItemId: id };
  },
);
on(
  "POST",
  `${W}/conversations/{conversationId}/messages/{messageId}/retry`,
  ({ s, params }) => {
    const m = conv(s, params.conversationId).thread.find(
      (x) => x.id === params.messageId,
    );
    if (m) m.state = "sent";
  },
);
on(
  "POST",
  `${W}/conversations/{conversationId}/attachments`,
  ({ query, uploadedBytes }) =>
    created({
      id: freshId(),
      name: query.get("name") ?? "file",
      contentType: "application/octet-stream",
      size: uploadedBytes,
    }),
);
on(
  "GET",
  `${W}/conversations/{conversationId}/attachments/{attachmentId}`,
  () =>
    new Response("Sample file", {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": 'attachment; filename="sample.txt"',
      },
    }),
);

// ---- canned replies and settings
on("GET", `${W}/inbox/canned-replies`, ({ s }) => ({
  replies: s.cannedReplies,
}));
on("POST", `${W}/inbox/canned-replies`, ({ s, body }) => {
  const r = {
    id: freshId(),
    name: String(body.name),
    body: String(body.body),
    updatedAt: now(),
  };
  s.cannedReplies.push(r);
  return created({ id: r.id });
});
on(
  "PUT",
  `${W}/inbox/canned-replies/{cannedReplyId}`,
  ({ s, params, body }) => {
    const r = s.cannedReplies.find((x) => x.id === params.cannedReplyId);
    if (!r) throw notFound("That reply");
    Object.assign(r, {
      name: String(body.name),
      body: String(body.body),
      updatedAt: now(),
    });
  },
);
on("DELETE", `${W}/inbox/canned-replies/{cannedReplyId}`, ({ s, params }) => {
  s.cannedReplies = s.cannedReplies.filter(
    (x) => x.id !== params.cannedReplyId,
  );
});
on("GET", `${W}/inbox/stats`, ({ s }) => ({
  days: 30,
  open: s.conversations.filter((c) => c.state === "open").length,
  mine: s.conversations.filter(
    (c) => c.state === "open" && c.assignee === ME,
  ).length,
  unassigned: s.conversations.filter(
    (c) => c.state === "open" && !c.assignee,
  ).length,
  closed: s.conversations.filter((c) => c.state === "closed").length,
  unread: s.conversations.filter(
    (c) =>
      c.state === "open" &&
      (c.thread.at(-1)?.seq ?? 0) > (c.readSeq ?? 0),
  ).length,
  answered: 42,
  medianMinutes: 11,
  p90Minutes: 55,
  waiting: s.conversations.filter(
    (c) => c.state === "open" && lastTalk(c)?.direction === "in",
  ).length,
  oldestWaitingMinutes: 38,
  targetHours: s.inbox.targetHours,
  overTarget: 0,
}));
on(
  "PUT",
  `${W}/inbox/reply-target`,
  ({ s, body }) => void (s.inbox.targetHours = Number(body.hours)),
);
on("GET", `${W}/inbox/settings`, ({ s }) => ({
  chatEnabled: s.inbox.chatEnabled,
  emailEnabled: s.inbox.emailEnabled,
  origins: s.inbox.origins,
  greeting: s.inbox.greeting,
  widgetToken: s.inbox.widgetToken,
  inboundKey: s.inbox.inboundKey,
}));
on("PUT", `${W}/inbox/settings`, ({ s, body }) => {
  Object.assign(s.inbox, {
    chatEnabled: Boolean(body.chatEnabled),
    emailEnabled: Boolean(body.emailEnabled),
    origins: body.origins ?? [],
    greeting: body.greeting ?? s.inbox.greeting,
  });
  if (body.rotateWidget)
    s.inbox.widgetToken = `sample-widget-${freshId().slice(0, 8)}`;
  if (body.rotateInbound)
    s.inbox.inboundKey = `sample-inbound-${freshId().slice(0, 8)}`;
  return {
    chatEnabled: s.inbox.chatEnabled,
    emailEnabled: s.inbox.emailEnabled,
    origins: s.inbox.origins,
    greeting: s.inbox.greeting,
    widgetToken: s.inbox.widgetToken,
    inboundKey: s.inbox.inboundKey,
  };
});

// ---- the chat window a visitor sees (no sign-in)
const visitorConv = (s: Store, visitor: string) =>
  s.conversations.find((c) => c.visitor === visitor);
on("GET", "/v1/public/chat/{token}/config", ({ s }) => ({
  workspaceName: s.workspace.name,
  greeting: s.inbox.greeting,
}));
on("GET", "/v1/public/chat/{token}/messages", ({ s, query }) => {
  const c = visitorConv(s, query.get("visitor") ?? "");
  const after = Number(query.get("after") ?? 0);
  return {
    messages: (c?.thread ?? [])
      .filter((m) => m.direction !== "note" && m.seq > after)
      .map((m) => ({
        seq: m.seq,
        fromTeam: m.direction === "out",
        text: m.body,
        at: m.at,
        files: m.files,
      })),
  };
});
on("POST", "/v1/public/chat/{token}/messages", ({ s, body }) => {
  let c = visitorConv(s, body.visitor);
  if (!c) {
    c = {
      id: freshId(),
      channel: "chat",
      state: "open",
      subject: String(body.text).slice(0, 60),
      customerName: body.name || "Website visitor",
      customerEmail: body.email ?? "",
      visitor: body.visitor,
      thread: [],
      cards: [],
    };
    s.conversations.unshift(c);
  }
  c.thread.push({
    id: freshId(),
    seq: next(c),
    direction: "in",
    body: String(body.text),
    state: "received",
    at: now(),
    sentOn: false,
    files: [],
  });
  // A teammate answers a few seconds later, so the window shows both sides.
  const target = c;
  setTimeout(
    () =>
      target.thread.push({
        id: freshId(),
        seq: next(target),
        direction: "out",
        body: "Thanks for writing. A teammate is on it.",
        authorId: ME,
        state: "sent",
        at: now(),
        sentOn: false,
        files: [],
      }),
    3000,
  );
  return new Response(JSON.stringify({ received: true }), {
    status: 202,
    headers: { "Content-Type": "application/json" },
  });
});
on("POST", "/v1/public/chat/{token}/attachments", ({ query, uploadedBytes }) =>
  created({
    id: freshId(),
    name: query.get("name") ?? "file",
    contentType: "application/octet-stream",
    size: uploadedBytes,
  }),
);
on(
  "GET",
  "/v1/public/chat/{token}/attachments/{attachmentId}",
  () =>
    new Response("Sample file", {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": 'attachment; filename="sample.txt"',
      },
    }),
);
