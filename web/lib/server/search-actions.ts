"use server";

import { api, unwrap } from "@/lib/server/api";
import { attempt } from "@/lib/server/actions-util";
import { isUuid } from "@/lib/text";

export type QuoteHit = {
  kind: "evidence" | "highlight";
  id: string;
  text: string;
  sourceItemId: string;
  sourceTitle: string;
};
export type RequestHit = { id: string; title: string; status: string };
export type PersonHit = { id: string; name: string; email?: string; accountName?: string };
export type CompanyHit = { id: string; name: string; peopleCount: number };
export type FindingHit = { id: string; title: string; state: "draft" | "published" };

export type SearchResults = {
  quotes: QuoteHit[];
  requests: RequestHit[];
  people: PersonHit[];
  companies: CompanyHit[];
  findings: FindingHit[];
};

export type Scopes = {
  quotes: boolean;
  requests: boolean;
  findings: boolean;
  people: boolean;
  companies: boolean;
};

const EMPTY: SearchResults = { quotes: [], requests: [], people: [], companies: [], findings: [] };

/**
 * What the command palette finds for some words, across quotes, requests, people, companies and findings, in one
 * round trip. Each kind is its own API call and they run together; one that fails (a tool this plan lacks, a role
 * that may not read it, a slow service) just contributes nothing, and `failed` is only set when every call that
 * was made failed, so the palette can say search is unavailable instead of "no matches". Quote search is for the
 * words inside a quote; meaning search stays on the Quotes screen, where it can say when it is not set up. The
 * API still checks the caller's role and tenant on every call, so `scopes` only saves calls.
 */
export async function searchWorkspaceAction(
  workspaceId: string,
  words: string,
  scopes: Scopes,
): Promise<SearchResults & { failed?: boolean }> {
  if (!isUuid(workspaceId)) return { ...EMPTY, failed: true };
  const q = words.trim().slice(0, 100);
  if (q.length < 2) return EMPTY;
  const path = { workspaceId };
  const client = await api();
  let made = 0;
  let failed = 0;
  async function run<T>(want: boolean, fn: () => Promise<T>, none: T): Promise<T> {
    if (!want) return none;
    made++;
    const res = await attempt(fn);
    if (!res.ok) {
      failed++;
      return none;
    }
    return res.value;
  }

  const [quotes, requests, people, companies, findings] = await Promise.all([
    run(scopes.quotes, async () =>
      unwrap(await client.GET("/v1/workspaces/{workspaceId}/quotes", { params: { path, query: { q, limit: 4 } } }))
        .quotes ?? [], []),
    run(scopes.requests, async () =>
      unwrap(await client.GET("/v1/workspaces/{workspaceId}/requests", { params: { path, query: { q, limit: 4 } } }))
        .requests, []),
    run(scopes.people, async () =>
      unwrap(await client.GET("/v1/workspaces/{workspaceId}/people", { params: { path, query: { q, limit: 3 } } }))
        .people, []),
    run(scopes.companies, async () =>
      unwrap(await client.GET("/v1/workspaces/{workspaceId}/accounts", { params: { path, query: { q, limit: 3 } } }))
        .accounts, []),
    run(scopes.findings, async () =>
      unwrap(await client.GET("/v1/workspaces/{workspaceId}/findings", { params: { path, query: { q } } }))
        .documents.slice(0, 3), []),
  ]);

  return {
    quotes: quotes.map((r) => ({
      kind: r.kind,
      id: r.id,
      text: r.text,
      sourceItemId: r.sourceItemId,
      sourceTitle: r.sourceTitle,
    })),
    requests: requests.map((r) => ({ id: r.id, title: r.title, status: r.status.name })),
    people: people.map((p) => ({ id: p.id, name: p.name, email: p.email, accountName: p.accountName })),
    companies: companies.map((a) => ({ id: a.id, name: a.name, peopleCount: a.peopleCount })),
    findings: findings.map((f) => ({ id: f.id, title: f.title, state: f.state })),
    failed: made > 0 && failed === made ? true : undefined,
  };
}
