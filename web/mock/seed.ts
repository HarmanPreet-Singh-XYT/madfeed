import type { Store, SourceRec } from "./store";
import { uid } from "./ids";
import { seedSurveys } from "./seed-surveys";

// Sample data for the preview build. Everything here is made up: no real people, companies or products.

const DAY = 86_400_000;
const ago = (days: number, hours = 0) =>
  new Date(Date.now() - days * DAY - hours * 3_600_000).toISOString();

/** Where a phrase sits in a text, as the byte offsets the product stores. The phrase must appear exactly. */
function span(text: string, phrase: string) {
  const i = text.indexOf(phrase);
  if (i < 0) throw new Error(`sample quote not in its source: ${phrase}`);
  const enc = new TextEncoder();
  const start = enc.encode(text.slice(0, i)).length;
  return {
    quote: phrase,
    spanStart: start,
    spanEnd: start + enc.encode(phrase).length,
  };
}

export function seed(empty: boolean): Store {
  const ws = uid(1);
  const st = {
    new: uid(10),
    review: uid(11),
    planned: uid(12),
    doing: uid(13),
    shipped: uid(14),
    wont: uid(15),
  };
  const statuses = [
    { id: st.new, name: "New", bucket: "open" as const, position: 1 },
    {
      id: st.review,
      name: "Under review",
      bucket: "open" as const,
      position: 2,
    },
    { id: st.planned, name: "Planned", bucket: "active" as const, position: 3 },
    {
      id: st.doing,
      name: "In progress",
      bucket: "active" as const,
      position: 4,
    },
    { id: st.shipped, name: "Shipped", bucket: "done" as const, position: 5 },
    { id: st.wont, name: "Won't do", bucket: "closed" as const, position: 6 },
  ];
  const ref = (id: string) => {
    const s = statuses.find((x) => x.id === id)!;
    return { id: s.id, name: s.name, bucket: s.bucket };
  };

  const base: Store = {
    workspace: { id: ws, name: "Northwind Support", role: "admin" },
    settings: {
      name: "Northwind Support",
      publicSlug: "northwind",
      senderName: "The Northwind team",
      senderAddress: "updates@northwind.example",
      replyTo: "support@northwind.example",
      emailConfigured: true,
    },
    access: {
      role: "admin",
      permissions: ["workspace:read", "workspace:write", "workspace:manage"],
      modules: ["feedback", "research", "surveys", "support"],
    },
    statuses,
    tags: [],
    people: [],
    sources: [],
    proposals: [],
    requests: [],
    briefs: {},
    batches: [],
    notes: [],
    views: [],
    notices: [],
    deleted: false,
    issues: {},
    accounts: [],
    team: {
      members: [
        {
          userId: "00000000-0000-4000-8000-0000000000a1",
          name: "You (demo)",
          role: "admin",
          isMe: true,
        },
      ],
      invitations: [],
    },
    apiKeys: [],
    webhooks: [],
    digest: { enabled: false, weekday: 1, hourUtc: 8, recipients: [] },
    form: {
      enabled: true,
      key: "sample-form-key-not-real",
      origins: ["https://www.northwind.example"],
    },
    votingSecret: false,
    planId: "team",
    grants: [],
    integrations: {},
    conversations: [],
    cannedReplies: [],
    inbox: {
      chatEnabled: true,
      emailEnabled: true,
      origins: ["https://www.northwind.example"],
      greeting: "Hi! How can we help?",
      widgetToken: "sample-widget-not-real",
      inboundKey: "sample-inbound-not-real",
      targetHours: 4,
    },
    findings: [],
    surveys: [],
    media: [],
    trash: [],
    mediaCompletedAt: {},
    transcripts: {},
    suggestions: [],
    highlights: [],
    answers: [],
    merges: [],
    audit: [],
    feelings: {},
    votes: new Set(),
  };
  if (empty) return base;

  // ---- people and accounts
  const acc = {
    harbor: uid(20),
    bright: uid(21),
    north: uid(22),
    tide: uid(23),
  };
  const person = (
    n: number,
    name: string,
    email: string,
    accountId: string,
    accountName: string,
  ) => ({ id: uid(30 + n), name, email, accountId, accountName });
  const dana = person(
    1,
    "Dana Whitfield",
    "dana@harbor.example",
    acc.harbor,
    "Harbor Analytics",
  );
  const marcus = person(
    2,
    "Marcus Oyelaran",
    "marcus@harbor.example",
    acc.harbor,
    "Harbor Analytics",
  );
  const priya = person(
    3,
    "Priya Raman",
    "priya@brightlane.example",
    acc.bright,
    "Brightlane",
  );
  const tom = person(
    4,
    "Tom Becker",
    "tom@brightlane.example",
    acc.bright,
    "Brightlane",
  );
  const lena = person(
    5,
    "Lena Fischer",
    "lena@northgate.example",
    acc.north,
    "Northgate Logistics",
  );
  const sam = person(
    6,
    "Sam Ortega",
    "sam@tidepool.example",
    acc.tide,
    "Tidepool",
  );
  base.people = [dana, marcus, priya, tom, lena, sam];
  base.accounts = [
    {
      id: acc.harbor,
      name: "Harbor Analytics",
      domain: "harbor.example",
      revenue: "48000.00",
      plan: "Annual",
      renewalDate: "2027-03-01",
      peopleCount: 2,
    },
    {
      id: acc.bright,
      name: "Brightlane",
      domain: "brightlane.example",
      revenue: "36000.00",
      plan: "Annual",
      renewalDate: "2027-01-15",
      peopleCount: 2,
    },
    {
      id: acc.north,
      name: "Northgate Logistics",
      domain: "northgate.example",
      peopleCount: 1,
    },
    {
      id: acc.tide,
      name: "Tidepool",
      domain: "tidepool.example",
      revenue: "12000.00",
      plan: "Monthly",
      peopleCount: 1,
    },
  ];
  base.team.members.push(
    {
      userId: "00000000-0000-4000-8000-0000000000a2",
      name: "Jo Alvarez",
      role: "member",
      isMe: false,
    },
    {
      userId: "00000000-0000-4000-8000-0000000000a3",
      name: "Kim Nakamura",
      role: "viewer",
      isMe: false,
    },
  );
  base.team.invitations = [
    {
      id: uid(1300),
      email: "robin@northwind.example",
      role: "member",
      createdAt: ago(2),
      expiresAt: ago(-5),
      link: `http://localhost:3100/invite/${uid(1300)}`,
    },
  ];
  base.apiKeys = [
    {
      id: uid(1310),
      name: "Reporting script",
      prefix: "fb_sample1",
      createdAt: ago(14),
      lastUsedAt: ago(1),
      revoked: false,
      scopes: ["requests", "quotes"],
    },
  ];
  base.grants = [
    {
      id: uid(1320),
      clientName: "Sample assistant",
      scopes: ["requests", "quotes", "ask"],
      createdAt: ago(9),
      lastUsedAt: ago(1),
    },
  ];

  // ---- the conversations
  const s1text =
    "Call with Harbor Analytics, Tuesday.\n\nDana: Our security team will not sign off unless we can sign in with single sign-on. Right now everyone has a separate password and that is a blocker for the renewal.\nMarcus: Agreed. We would also like a message in Slack when a new request comes in, so the team sees it without opening the app.\nDana: And the quote cards are great, they make it easy to defend a decision in our planning meeting.";
  const s2text =
    "Email from Priya at Brightlane\n\nHi team, we love the product but we need single sign-on through our identity provider before we can roll this out to all 40 people. Tom also asked whether there will be a mobile app; our field staff mostly work from their phones. We can wait a quarter for SSO but not much longer.";
  const s3text =
    "Support chat, Northgate Logistics (Lena) and Tidepool (Sam)\n\nLena: Is there a way to export the request list to CSV? I have to copy everything into a spreadsheet by hand for my manager.\nLena: Also changing tags one at a time takes forever, I wish I could edit many requests at once.\nSam: Late at night the white background is really harsh. A dark mode would help a lot.";
  const s4text =
    "Interview notes, week 41 (Tidepool, Brightlane)\n\nPriya: We would really like an audit log so we can see who changed a request's status.\nTom: SSO again, honestly it is the first thing our admin asks about.\nSam: The weekly digest sent me the same email twice on Monday, that looked like a bug.\nPriya: The cited quotes are the best part, nothing else shows me where an idea came from.\nTom: How do I invite someone who only needs to read?";
  const src = (
    n: number,
    title: string,
    text: string,
    days: number,
  ): SourceRec => ({
    id: uid(40 + n),
    kind: "paste",
    redactions: 0,
    title,
    state: "done",
    createdAt: ago(days),
    text,
  });
  base.sources = [
    src(1, "Call with Harbor Analytics", s1text, 12),
    src(2, "Email from Brightlane", s2text, 9),
    src(3, "Support chat: Northgate and Tidepool", s3text, 6),
    src(4, "Interview notes, week 41", s4text, 1),
  ];

  // ---- tags
  const tag = (
    n: number,
    name: string,
    color: string,
    definition: string,
    highlightCount: number,
    requestCount: number,
  ) => ({
    id: uid(50 + n),
    name,
    color,
    definition,
    origin: "human" as const,
    archived: false,
    highlightCount,
    requestCount,
  });
  base.tags = [
    tag(
      1,
      "Security",
      "#b45309",
      "Anything about access, sign-in or compliance.",
      4,
      1,
    ),
    tag(2, "Integrations", "blue", "Working with other tools.", 3, 1),
    tag(3, "Reporting", "green", "Getting data out.", 2, 1),
    tag(4, "Usability", "purple", "Everyday friction.", 5, 3),
    tag(5, "Mobile", "red", "Phones and tablets.", 1, 1),
  ];
  const tr = (i: number) => ({
    id: base.tags[i].id,
    name: base.tags[i].name,
    color: base.tags[i].color,
  });

  // ---- requests with evidence
  const ev = (
    n: number,
    sourceIdx: number,
    text: string,
    phrase: string,
    days: number,
  ) => ({
    id: uid(100 + n),
    sourceItemId: base.sources[sourceIdx].id,
    ...span(text, phrase),
    confidence: 0.9,
    createdAt: ago(days),
  });
  const impact = (
    e: number,
    p: number,
    a: number,
    value: string,
    withValue: number,
    newest: number,
  ) => ({
    evidenceCount: e,
    peopleCount: p,
    accountCount: a,
    totalValue: value,
    accountsWithValue: withValue,
    newestEvidenceAt: ago(newest),
  });
  const request = (
    n: number,
    title: string,
    statusId: string,
    tagIdx: number[],
    evidence: ReturnType<typeof ev>[],
    imp: ReturnType<typeof impact>,
    days: number,
    more: object = {},
  ) => ({
    id: uid(200 + n),
    title,
    createdVia: "machine" as const,
    createdAt: ago(days),
    status: ref(statusId),
    tags: tagIdx.map(tr),
    public: false,
    publicTitle: "",
    publicSummary: "",
    voteCount: 0,
    verifiedVoteCount: 0,
    verifiedVoters: [],
    informed: [],
    releaseNotes: [],
    impact: imp,
    evidence,
    ...more,
  });
  const e1 = ev(
    1,
    0,
    s1text,
    "Our security team will not sign off unless we can sign in with single sign-on.",
    12,
  );
  const e2 = ev(
    2,
    1,
    s2text,
    "we need single sign-on through our identity provider before we can roll this out to all 40 people",
    9,
  );
  const e3 = ev(
    3,
    0,
    s1text,
    "We would also like a message in Slack when a new request comes in",
    12,
  );
  const e4 = ev(
    4,
    2,
    s3text,
    "Is there a way to export the request list to CSV?",
    6,
  );
  const e5 = ev(5, 2, s3text, "A dark mode would help a lot.", 6);
  const e6 = ev(
    6,
    2,
    s3text,
    "changing tags one at a time takes forever, I wish I could edit many requests at once",
    6,
  );
  const e7 = ev(
    7,
    1,
    s2text,
    "Tom also asked whether there will be a mobile app",
    9,
  );
  const e8 = ev(
    8,
    3,
    s4text,
    "SSO again, honestly it is the first thing our admin asks about.",
    1,
  );

  const r1 = request(
    1,
    "Single sign-on (SAML) for our team",
    st.planned,
    [0],
    [e1, e2, e8],
    impact(3, 3, 2, "84000.00", 2, 1),
    12,
    {
      public: true,
      publicTitle: "Single sign-on",
      publicSummary: "Sign in with your company's identity provider.",
      voteCount: 14,
      verifiedVoteCount: 5,
      verifiedVoters: [
        { personId: dana.id, name: dana.name, accountName: "Harbor Analytics" },
        { personId: priya.id, name: priya.name, accountName: "Brightlane" },
      ],
    },
  );
  const r2 = request(
    2,
    "Export the request list to CSV",
    st.shipped,
    [2],
    [e4],
    impact(1, 1, 1, "0", 0, 6),
    6,
    {
      public: true,
      publicTitle: "CSV export",
      publicSummary: "Download any request list as a spreadsheet.",
      voteCount: 9,
      verifiedVoteCount: 2,
      openBatchId: uid(300),
    },
  );
  const r3 = request(
    3,
    "Slack notifications for new requests",
    st.doing,
    [1],
    [e3],
    impact(1, 1, 1, "48000.00", 1, 12),
    12,
    {
      public: true,
      publicTitle: "Slack notifications",
      publicSummary: "Get a message in a channel when a request arrives.",
      voteCount: 7,
      verifiedVoteCount: 1,
    },
  );
  const r4 = request(
    4,
    "Dark mode",
    st.new,
    [3],
    [e5],
    impact(1, 1, 1, "12000.00", 1, 6),
    6,
  );
  const r5 = request(
    5,
    "Edit many requests at once",
    st.review,
    [3],
    [e6],
    impact(1, 1, 1, "0", 0, 6),
    6,
  );
  const r6 = request(
    6,
    "A mobile app",
    st.wont,
    [4],
    [e7],
    impact(1, 1, 1, "36000.00", 1, 9),
    9,
    {
      public: true,
      publicTitle: "Mobile app",
      publicSummary: "A phone app for field teams.",
      voteCount: 4,
      verifiedVoteCount: 0,
    },
  );
  base.requests = [r1, r2, r3, r4, r5, r6] as Store["requests"];

  // ---- the review queue: what the model found in the newest conversation, waiting for a person
  const prop = (
    n: number,
    kind: "new_request" | "evidence_for",
    statementKind: "need" | "bug" | "praise" | "question",
    title: string,
    phrase: string,
    extra: object = {},
  ) => ({
    id: uid(400 + n),
    sourceItemId: base.sources[3].id,
    kind,
    statementKind,
    title,
    ...span(s4text, phrase),
    confidence: 0.84,
    state: "suggested" as const,
    createdAt: ago(1),
    ...extra,
  });
  base.proposals = [
    prop(
      1,
      "new_request",
      "need",
      "Audit log for admin actions",
      "We would really like an audit log so we can see who changed a request's status.",
    ),
    prop(
      2,
      "evidence_for",
      "need",
      "Single sign-on (SAML) for our team",
      "SSO again, honestly it is the first thing our admin asks about.",
      {
        suggestion: {
          requestId: r1.id,
          requestTitle: r1.title,
          score: 0.93,
          confidence: 0.9,
          reason: "Asks for the same sign-in method.",
        },
      },
    ),
    prop(
      3,
      "new_request",
      "bug",
      "Weekly digest arrives twice",
      "The weekly digest sent me the same email twice on Monday, that looked like a bug.",
    ),
    prop(
      4,
      "new_request",
      "praise",
      "Cited quotes are valued",
      "The cited quotes are the best part, nothing else shows me where an idea came from.",
    ),
    prop(
      5,
      "new_request",
      "question",
      "Read-only invitations",
      "How do I invite someone who only needs to read?",
    ),
  ] as Store["proposals"];

  // ---- messages after shipping the CSV export
  const msg = (
    n: number,
    p: typeof lena,
    state: "draft" | "approved" | "sent",
    quote: string,
  ) => ({
    id: uid(320 + n),
    personId: p.id,
    personName: p.name,
    accountName: p.accountName,
    toEmail: p.email,
    state,
    subject: "CSV export is here",
    edited: false,
    draftedBy: "model" as const,
    body: `Hi ${p.name.split(" ")[0]},\n\nYou asked whether the request list could be exported. It can now: open Requests, choose Export, and you get a spreadsheet.\n\nThank you for telling us, it made this easy to prioritise.\n\nThe Northwind team`,
    quotes: [{ evidenceId: e4.id, text: quote }],
  });
  base.batches = [
    {
      id: uid(300),
      requestId: r2.id,
      requestTitle: r2.title,
      state: "review",
      createdAt: ago(0, 3),
      noEmail: 0,
      anonymousQuotes: 0,
      readyToSend: 0,
      messages: [
        msg(
          1,
          lena,
          "draft",
          "Is there a way to export the request list to CSV?",
        ),
        msg(
          2,
          sam,
          "draft",
          "Is there a way to export the request list to CSV?",
        ),
      ],
    },
    {
      id: uid(301),
      requestId: r3.id,
      requestTitle: r3.title,
      state: "done",
      createdAt: ago(20),
      noEmail: 0,
      anonymousQuotes: 0,
      readyToSend: 0,
      messages: [
        {
          ...msg(
            3,
            dana,
            "sent",
            "We would also like a message in Slack when a new request comes in",
          ),
          subject: "Slack notifications are live",
          sentAt: ago(19),
        },
      ],
    },
  ] as Store["batches"];

  // ---- release notes
  base.notes = [
    {
      id: uid(500),
      title: "Export to CSV",
      type: "new",
      body: "You can now download any request list as a spreadsheet. Open Requests and choose Export.",
      state: "published",
      publishedAt: ago(5),
      liveNow: true,
      requests: [{ id: r2.id, title: r2.title }],
      createdAt: ago(6),
      updatedAt: ago(5),
    },
    {
      id: uid(501),
      title: "Slack notifications",
      type: "improved",
      body: "Choose a channel and we will post when a new request arrives.",
      state: "draft",
      liveNow: false,
      requests: [{ id: r3.id, title: r3.title }],
      createdAt: ago(2),
      updatedAt: ago(2),
    },
    {
      id: uid(502),
      title: "Single sign-on",
      type: "new",
      body: "Sign in with your company's identity provider.",
      state: "scheduled",
      scheduledFor: ago(-6),
      liveNow: false,
      requests: [{ id: r1.id, title: r1.title }],
      createdAt: ago(3),
      updatedAt: ago(1),
    },
    {
      id: uid(503),
      title: "Bulk edit requests",
      type: "fixed",
      body: "Edit many requests at once from the Requests page.",
      state: "unpublished",
      publishedAt: ago(14),
      liveNow: false,
      requests: [],
      createdAt: ago(15),
      updatedAt: ago(14),
    },
  ] as Store["notes"];

  base.views = [
    {
      id: uid(600),
      name: "Planned and in progress",
      statusId: st.planned,
      q: "",
      sort: "value",
      mine: false,
      createdAt: ago(10),
    },
    {
      id: uid(601),
      name: "Security asks",
      tagId: base.tags[0].id,
      q: "",
      sort: "newest",
      mine: false,
      createdAt: ago(8),
    },
  ];

  // ---- a brief for the top request
  base.briefs[r1.id] = {
    state: "ready",
    stale: false,
    lowEvidence: false,
    claim:
      "Three people at two paying accounts say single sign-on blocks their rollout.",
    disproof:
      "All three come from accounts already using the product; there is no evidence yet from teams that decided against buying because of sign-in.",
    quotes: [e1, e2, e8].map((e) => ({
      evidenceId: e.id,
      sourceItemId: e.sourceItemId,
      quote: e.quote,
      spanStart: e.spanStart,
      spanEnd: e.spanEnd,
    })),
    generatedAt: ago(1),
    facts: {
      evidenceCount: 3,
      newLast30Days: 3,
      unidentifiedQuotes: 0,
      peopleCount: 3,
      accountCount: 2,
      accountsWithValue: 2,
      totalValue: "84000.00",
      firstEvidenceAt: ago(12),
      newestEvidenceAt: ago(1),
      accounts: [
        {
          id: acc.harbor,
          name: "Harbor Analytics",
          revenue: "48000.00",
          peopleCount: 2,
        },
        {
          id: acc.bright,
          name: "Brightlane",
          revenue: "36000.00",
          peopleCount: 1,
        },
      ],
    },
  };

  // ---- a recorded interview with its transcript
  const rlines: [string, string][] = [
    ["Interviewer", "What slows you down most when rolling this out?"],
    [
      "Priya",
      "Honestly it is sign-in. Everyone has to remember another password, and our admin wants one place to switch people off.",
    ],
    ["Interviewer", "Anything else?"],
    [
      "Priya",
      "Reports. I export to a spreadsheet every Friday and it takes me an hour.",
    ],
  ];
  const rtext = rlines.map(([who, line]) => `${who}: ${line}`).join("\n");
  const rsource = {
    id: uid(801),
    kind: "recording" as const,
    redactions: 0,
    title: "Interview with Priya (recording)",
    state: "done" as const,
    createdAt: ago(3),
    text: rtext,
    mediaId: uid(800),
  };
  base.sources.push(rsource);
  base.media = [
    {
      id: uid(800),
      filename: "interview-priya.m4a",
      mimeType: "audio/mp4",
      sizeBytes: 2_400_000,
      receivedBytes: 2_400_000,
      chunkBytes: 1_048_576,
      state: "done",
      durationMs: 62_000,
      sourceItemId: rsource.id,
      createdAt: ago(3),
    },
  ];
  let at = 0;
  base.transcripts[rsource.id] = rlines.map(([who, line], i) => {
    const seg = {
      ordinal: i,
      startMs: at,
      endMs: at + 12_000 + i * 3_000,
      speaker: who,
      ...span(rtext, `${who}: ${line}`),
    };
    at = seg.endMs;
    return {
      ordinal: seg.ordinal,
      startMs: seg.startMs,
      endMs: seg.endMs,
      speaker: seg.speaker,
      spanStart: seg.spanStart,
      spanEnd: seg.spanEnd,
    };
  });
  base.suggestions = [
    {
      id: uid(802),
      sourceItemId: rsource.id,
      ...span(
        rtext,
        "Everyone has to remember another password, and our admin wants one place to switch people off.",
      ),
      confidence: 0.88,
      tags: [tr(0)],
    },
    {
      id: uid(803),
      sourceItemId: rsource.id,
      ...span(
        rtext,
        "I export to a spreadsheet every Friday and it takes me an hour.",
      ),
      confidence: 0.81,
      tags: [tr(2)],
    },
  ];

  base.surveys = seedSurveys(base.people, ago);

  // ---- the shared inbox
  const chatMsg = (
    n: number,
    direction: "in" | "out" | "note",
    body: string,
    days: number,
    extra: object = {},
  ) => ({
    id: uid(1000 + n),
    seq: n,
    direction,
    body,
    state: direction === "in" ? "received" : "sent",
    at: ago(days),
    sentOn: false,
    files: [],
    ...extra,
  });
  base.conversations = [
    {
      id: uid(1100),
      channel: "chat",
      state: "open",
      subject: "Can we export to CSV?",
      customerName: lena.name,
      customerEmail: lena.email,
      personId: lena.id,
      assignee: "00000000-0000-4000-8000-0000000000a1",
      thread: [
        chatMsg(
          1,
          "in",
          "Is there a way to export the request list to CSV? I have to copy everything by hand.",
          0.2,
        ),
        chatMsg(
          2,
          "out",
          "Hi Lena, not yet, but you are the second person to ask. I have passed it on.",
          0.1,
          { authorId: "00000000-0000-4000-8000-0000000000a1" },
        ),
        chatMsg(3, "note", "Linked to the CSV export request.", 0.09, {
          authorId: "00000000-0000-4000-8000-0000000000a1",
        }),
      ],
      cards: [
        {
          messageId: uid(1001),
          sourceItemId: base.sources[2].id,
          stage: "linked",
          waiting: 0,
          requests: [
            {
              id: r2.id,
              title: r2.title,
              status: r2.status.name,
              bucket: r2.status.bucket,
            },
          ],
        },
      ],
    },
    {
      id: uid(1101),
      channel: "email",
      state: "open",
      subject: "Invoice question",
      customerName: priya.name,
      customerEmail: priya.email,
      personId: priya.id,
      thread: [
        chatMsg(
          4,
          "in",
          "Could you resend last month's invoice? Our finance team cannot find it.",
          1,
        ),
      ],
      cards: [],
    },
    {
      id: uid(1102),
      channel: "chat",
      state: "open",
      subject: "Dark mode?",
      customerName: sam.name,
      customerEmail: sam.email,
      personId: sam.id,
      thread: [
        chatMsg(
          5,
          "in",
          "Late at night the white background is harsh. Is dark mode planned?",
          0.4,
        ),
      ],
      cards: [
        {
          messageId: uid(1005),
          sourceItemId: base.sources[2].id,
          stage: "waiting",
          waiting: 1,
          requests: [],
        },
      ],
    },
  ];
  base.cannedReplies = [
    {
      id: uid(1200),
      name: "Thanks, passed it on",
      body: "Thanks for telling us. I have passed this to the team and will let you know when it ships.",
      updatedAt: ago(10),
    },
    {
      id: uid(1201),
      name: "Invoice resend",
      body: "I have resent the invoice to the billing address on file. Let me know if it does not arrive.",
      updatedAt: ago(20),
    },
  ];

  base.findings = [
    {
      id: uid(940),
      title: "Why teams stall at rollout",
      state: "draft",
      updatedAt: ago(1),
      blocks: [
        {
          id: uid(941),
          kind: "text",
          body: "Across three accounts, the same thing stops a wider rollout: sign-in.",
        },
        {
          id: uid(942),
          kind: "quote",
          body: "This is what the security team told us.",
          quoteKind: "evidence",
          quoteId: e1.id,
        },
        {
          id: uid(943),
          kind: "quote",
          body: "",
          quoteKind: "evidence",
          quoteId: e2.id,
        },
        {
          id: uid(944),
          kind: "text",
          body: "It is not about features. It is about being allowed to adopt the product at all.",
        },
      ],
    },
  ];

  // ---- highlights people saved while reading
  const hl = (
    n: number,
    sourceIdx: number,
    text: string,
    phrase: string,
    note: string,
    tagIdx: number[],
    days: number,
  ) => ({
    id: uid(700 + n),
    sourceItemId: base.sources[sourceIdx].id,
    sourceTitle: base.sources[sourceIdx].title,
    ...span(text, phrase),
    note,
    tags: tagIdx.map(tr),
    createdAt: ago(days),
  });
  base.highlights = [
    hl(
      1,
      0,
      s1text,
      "that is a blocker for the renewal",
      "Ties sign-in to a renewal; worth raising with the account team.",
      [0],
      12,
    ),
    hl(
      2,
      0,
      s1text,
      "they make it easy to defend a decision in our planning meeting",
      "Why the quote cards matter.",
      [3],
      12,
    ),
    hl(
      3,
      2,
      s3text,
      "I have to copy everything into a spreadsheet by hand for my manager.",
      "",
      [2],
      6,
    ),
  ] as Store["highlights"];

  // ---- an answered question and a spot check
  const first = r1.evidence[0];
  base.answers = [
    {
      id: uid(710),
      question: "What is blocking rollouts?",
      outcome: "answered",
      reason: "",
      createdAt: ago(2),
      text: "Single sign-on is the most common blocker; customers say they cannot roll out without it [1][2].",
      citations: [e1, e2].map((e, i) => ({
        number: i + 1,
        kind: "evidence" as const,
        id: e.id,
        sourceItemId: e.sourceItemId,
        spanStart: e.spanStart,
        spanEnd: e.spanEnd,
        quote: e.quote,
      })),
    },
    {
      id: uid(711),
      question: "Do customers want a Windows app?",
      outcome: "no_evidence",
      reason: "No stored quote mentions a desktop app.",
      text: "",
      createdAt: ago(3),
      citations: [],
    },
  ] as Store["answers"];
  base.audit = [
    {
      id: uid(720),
      kind: "brief",
      sampledAt: ago(1),
      heading: r1.title,
      text: "Three people at two paying accounts say single sign-on blocks their rollout.",
      quotes: [
        {
          text: first.quote,
          sourceItemId: first.sourceItemId,
          spanStart: first.spanStart,
          spanEnd: first.spanEnd,
        },
      ],
    },
    {
      id: uid(721),
      kind: "answer",
      sampledAt: ago(4),
      heading: "What is blocking rollouts?",
      verdict: "supported",
      text: "Single sign-on is the most common blocker.",
      quotes: [
        {
          text: e2.quote,
          sourceItemId: e2.sourceItemId,
          spanStart: e2.spanStart,
          spanEnd: e2.spanEnd,
        },
      ],
    },
  ];
  return base;
}
