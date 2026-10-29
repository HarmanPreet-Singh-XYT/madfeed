import type { components } from "@/lib/api/schema.gen";
import { seed } from "./seed";

type S = components["schemas"];

// Everything the sample workspace holds, in memory. Mutations from clicking around change it; restarting the
// server puts it back. The types come from the API contract, so a changed contract breaks the build here.

export type SourceRec = S["Source"];
/** The stored request also keeps its manual roadmap order (the contract only exposes it on summaries). */
export type RequestRec = S["RequestDetail"] & {
  roadmapPosition?: number | null;
};
export type SurveyRec = {
  survey: S["Survey"];
  invites: S["SurveyInvite"][];
  responses: {
    id: string;
    complete: boolean;
    person: string;
    at: string;
    answers: {
      questionId: string;
      number?: number;
      choice?: string;
      text?: string;
    }[];
  }[];
};
export type Store = {
  workspace: S["Workspace"];
  settings: S["WorkspaceSettings"];
  access: {
    role: "admin" | "member" | "viewer";
    permissions: ("workspace:read" | "workspace:write" | "workspace:manage")[];
    modules: ("feedback" | "research" | "surveys" | "support")[];
  };
  statuses: S["Status"][];
  tags: S["Tag"][];
  people: S["Person"][];
  sources: SourceRec[];
  proposals: S["Proposal"][];
  requests: RequestRec[];
  briefs: Record<string, S["Brief"]>;
  batches: S["OutreachBatch"][];
  notes: S["ReleaseNote"][];
  views: S["SavedView"][];
  notices: {
    id: string;
    kind: "ai_budget";
    message: string;
    createdAt: string;
  }[];
  /** Set after the workspace is deleted: the workspace list is then empty until the data is reset. */
  deleted: boolean;
  /** The issue linked to a request, by request id. */
  issues: Record<string, S["IssueLink"]>;
  accounts: S["Account"][];
  team: {
    members: {
      userId: string;
      name: string;
      role: "admin" | "member" | "viewer";
      isMe: boolean;
    }[];
    invitations: S["Invitation"][];
  };
  apiKeys: S["ApiKey"][];
  webhooks: {
    endpoint: S["WebhookEndpoint"];
    secret: string;
    deliveries: S["WebhookDelivery"][];
  }[];
  digest: {
    enabled: boolean;
    weekday: number;
    hourUtc: number;
    recipients: { email: string; unsubscribed: boolean }[];
  };
  form: { enabled: boolean; key: string; origins: string[] };
  votingSecret: boolean;
  planId: string;
  grants: {
    id: string;
    clientName: string;
    scopes: ("requests" | "quotes" | "ask" | "submit" | "write")[];
    createdAt: string;
    lastUsedAt?: string;
  }[];
  /** Connections to outside tools, by kind; what was entered when connecting is kept in `config`. */
  integrations: Record<
    string,
    {
      summary: string;
      detail: string;
      connectedAt: string;
      config: Record<string, string>;
    }
  >;
  conversations: {
    id: string;
    channel: "chat" | "email";
    state: "open" | "closed";
    subject: string;
    customerName: string;
    customerEmail: string;
    personId?: string;
    assignee?: string;
    visitor?: string;
    thread: {
      id: string;
      seq: number;
      direction: "in" | "out" | "note";
      body: string;
      authorId?: string;
      state: string;
      at: string;
      sentOn: boolean;
      files: { id: string; name: string; contentType: string; size: number }[];
    }[];
    cards: {
      messageId: string;
      sourceItemId: string;
      stage: "processing" | "nothing" | "waiting" | "linked";
      waiting: number;
      requests: { id: string; title: string; status: string; bucket: string }[];
    }[];
  }[];
  cannedReplies: {
    id: string;
    name: string;
    body: string;
    updatedAt: string;
  }[];
  inbox: {
    chatEnabled: boolean;
    emailEnabled: boolean;
    origins: string[];
    greeting: string;
    widgetToken?: string;
    inboundKey?: string;
    targetHours: number;
  };
  findings: {
    id: string;
    title: string;
    state: "draft" | "published";
    publishedAt?: string;
    updatedAt: string;
    blocks: {
      id: string;
      kind: "text" | "quote";
      body: string;
      quoteKind?: "evidence" | "highlight";
      quoteId?: string;
    }[];
  }[];
  surveys: SurveyRec[];
  media: S["Media"][];
  /** When each upload was finished, so "transcribing" can turn into "done" a moment later. */
  mediaCompletedAt: Record<string, number>;
  transcripts: Record<string, S["Segment"][]>;
  suggestions: (S["HighlightSuggestion"] & { sourceItemId: string })[];
  highlights: S["Highlight"][];
  answers: S["Answer"][];
  /** Tag merges that can still be undone. */
  merges: {
    id: string;
    from: string;
    into: string;
    requestIds: string[];
    highlightIds: string[];
  }[];
  audit: {
    id: string;
    kind: "answer" | "brief";
    sampledAt: string;
    heading: string;
    text: string;
    verdict?: "supported" | "not_supported";
    note?: string;
    quotes: {
      text: string;
      sourceItemId: string;
      spanStart: number;
      spanEnd: number;
    }[];
  }[];
  /** Feelings set by hand on quotes, by quote id. */
  feelings: Record<string, "positive" | "neutral" | "negative" | "mixed">;
  /** Requests the demo visitor has voted for on the public roadmap. */
  votes: Set<string>;
};

type Holder = { [kind: string]: Store };
const g = globalThis as unknown as { __mockStores?: Holder };

/** One store per scenario ("empty" has no data), kept across requests and hot reloads. */
export async function getStore(scenario: string): Promise<Store> {
  const kind = scenario === "empty" ? "empty" : "full";
  g.__mockStores ??= {};
  g.__mockStores[kind] ??= seed(kind === "empty");
  return g.__mockStores[kind];
}

/** Puts the sample data back as it was when the server started. */
export function resetStores(): void {
  g.__mockStores = {};
  (
    globalThis as unknown as { __mockAccountRequest?: string }
  ).__mockAccountRequest = undefined;
}
