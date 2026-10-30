"use server";

import { revalidatePath } from "next/cache";
import { api, unwrap, unwrapEmpty } from "@/lib/server/api";
import { attempt, type FormState } from "@/lib/server/actions-util";
import { isUuid } from "@/lib/text";

const badMessage = "That link is not valid. Go back and try again.";
const bad: FormState = { error: badMessage };

export type ImportMapping = Partial<
  Record<
    "name" | "email" | "account" | "domain" | "revenue" | "plan" | "renewal",
    string
  >
>;

export type Preview = {
  delimiter: string;
  headers: string[];
  mapping: ImportMapping;
  totalRows: number;
  validRows: number;
  sample: string[][];
  errors: { row: number; column?: string; message: string }[];
  errorCount: number;
  warnings: string[];
};

export type ImportSummary = {
  accountsCreated: number;
  accountsUpdated: number;
  peopleCreated: number;
  peopleUpdated: number;
  skipped: number;
};

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

// These are called directly from the import screen, which keeps the file text in
// the browser until the person confirms. Every call re-checks the session and
// the API checks the role again.
export async function previewImport(
  workspaceId: string,
  csv: string,
  mapping?: ImportMapping,
): Promise<Result<Preview>> {
  if (!isUuid(workspaceId)) return { ok: false, error: badMessage };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/people/import/preview", {
        params: { path: { workspaceId } },
        body: {
          csv,
          ...(mapping && Object.keys(mapping).length ? { mapping } : {}),
        },
      }),
    ),
  );
  if (!res.ok)
    return { ok: false, error: res.state?.error ?? "Could not read the file." };
  return { ok: true, data: res.value as Preview };
}

export async function runImport(
  workspaceId: string,
  csv: string,
  mapping: ImportMapping | undefined,
  skipInvalidRows: boolean,
): Promise<Result<ImportSummary>> {
  if (!isUuid(workspaceId)) return { ok: false, error: badMessage };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/people/import", {
        params: { path: { workspaceId } },
        body: {
          csv,
          skipInvalidRows,
          ...(mapping && Object.keys(mapping).length ? { mapping } : {}),
        },
      }),
    ),
  );
  if (!res.ok)
    return { ok: false, error: res.state?.error ?? "The import failed." };
  revalidatePath(`/w/${workspaceId}/people`);
  return { ok: true, data: res.value };
}

export async function createAccountAction(
  workspaceId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!isUuid(workspaceId)) return bad;
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Give the account a name." };
  const field = (k: string) => String(formData.get(k) ?? "").trim();
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/accounts", {
        params: { path: { workspaceId } },
        body: {
          name,
          ...(field("revenue") ? { revenue: field("revenue") } : {}),
          ...(field("plan") ? { plan: field("plan") } : {}),
          ...(field("renewalDate")
            ? { renewalDate: field("renewalDate") }
            : {}),
        },
      }),
    ),
  );
  if (!res.ok) return res.state;
  revalidatePath(`/w/${workspaceId}/people`);
  return undefined;
}

export async function updateAccountAction(
  workspaceId: string,
  accountId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!isUuid(workspaceId) || !isUuid(accountId)) return bad;
  const field = (k: string) => String(formData.get(k) ?? "").trim();
  if (!field("name")) return { error: "The account needs a name." };
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).PUT("/v1/workspaces/{workspaceId}/accounts/{accountId}", {
        params: { path: { workspaceId, accountId } },
        body: {
          name: field("name"),
          ...(field("revenue") ? { revenue: field("revenue") } : {}),
          ...(field("plan") ? { plan: field("plan") } : {}),
          ...(field("renewalDate")
            ? { renewalDate: field("renewalDate") }
            : {}),
          ...(field("domain") ? { domain: field("domain") } : {}),
        },
      }),
    ),
  );
  if (!res.ok) return res.state;
  revalidatePath(`/w/${workspaceId}`, "layout");
  return undefined;
}

/**
 * Adds a person from a picker and hands the new id back so the caller can select
 * them straight away. Unlike createPersonAction it does not redirect.
 */
export async function createPersonLookup(
  workspaceId: string,
  name: string,
): Promise<{ id?: string; error?: string }> {
  if (!isUuid(workspaceId)) return { error: badMessage };
  const trimmed = name.trim();
  if (!trimmed) return { error: "Enter a name." };
  if (trimmed.length > 200) return { error: "That name is too long." };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/people", {
        params: { path: { workspaceId } },
        body: { name: trimmed },
      }),
    ),
  );
  if (!res.ok)
    return { error: res.state?.error ?? "Could not add that person." };
  revalidatePath(`/w/${workspaceId}/people`);
  return { id: res.value.id };
}

export async function createPersonAction(
  workspaceId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!isUuid(workspaceId)) return bad;
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const accountId = String(formData.get("accountId") ?? "");
  if (!name && !email) return { error: "Enter a name or an email." };
  if (accountId && !isUuid(accountId)) return bad;
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/people", {
        params: { path: { workspaceId } },
        body: {
          ...(name ? { name } : {}),
          ...(email ? { email } : {}),
          ...(accountId ? { accountId } : {}),
        },
      }),
    ),
  );
  if (!res.ok) return res.state;
  revalidatePath(`/w/${workspaceId}/people`);
  return undefined;
}

/** Replaces a person's name, email and company. An empty email clears it. */
export async function updatePersonFields(
  workspaceId: string,
  personId: string,
  input: { name: string; email: string; accountId: string },
): Promise<{ error?: string; notice?: string }> {
  if (!isUuid(workspaceId) || !isUuid(personId)) return { error: badMessage };
  const name = input.name.trim();
  if (!name) return { error: "Enter a name." };
  if (name.length > 200) return { error: "That name is too long." };
  if (input.accountId && !isUuid(input.accountId)) return { error: badMessage };
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).PUT("/v1/workspaces/{workspaceId}/people/{personId}", {
        params: { path: { workspaceId, personId } },
        body: {
          name,
          email: input.email.trim().slice(0, 320),
          ...(input.accountId ? { accountId: input.accountId } : {}),
        },
      }),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  revalidatePath(`/w/${workspaceId}/people`);
  revalidatePath(`/w/${workspaceId}/quotes`);
  return { notice: "Saved." };
}

/** Replaces a company's details. An empty field means "leave it out" (the API keeps the old value). */
export async function updateAccountFields(
  workspaceId: string,
  accountId: string,
  input: {
    name: string;
    revenue: string;
    plan: string;
    renewalDate: string;
    domain: string;
  },
): Promise<{ error?: string; notice?: string }> {
  if (!isUuid(workspaceId) || !isUuid(accountId)) return { error: badMessage };
  const name = input.name.trim();
  if (!name) return { error: "The company needs a name." };
  if (name.length > 200) return { error: "That name is too long." };
  const money = input.revenue.trim();
  if (money && !/^\d+(\.\d{1,2})?$/.test(money))
    return { error: "Revenue should be a number, like 48000 or 48000.50." };
  const day = input.renewalDate.trim();
  if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day))
    return { error: "Renewal date should be a date." };
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).PUT("/v1/workspaces/{workspaceId}/accounts/{accountId}", {
        params: { path: { workspaceId, accountId } },
        body: {
          name,
          ...(money ? { revenue: money } : {}),
          ...(input.plan.trim() ? { plan: input.plan.trim().slice(0, 100) } : {}),
          ...(day ? { renewalDate: day } : {}),
          ...(input.domain.trim() ? { domain: input.domain.trim().slice(0, 200) } : {}),
        },
      }),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  revalidatePath(`/w/${workspaceId}`, "layout");
  return { notice: "Saved." };
}

export type PersonQuote = {
  kind: "evidence" | "highlight";
  id: string;
  text: string;
  sourceItemId: string;
  sourceTitle: string;
  sourceKind: string;
  at: string;
  requestId?: string;
  requestTitle?: string;
};

/** The latest quotes from one person, for their side panel. */
export async function personQuotesAction(
  workspaceId: string,
  personId: string,
): Promise<{ error?: string; quotes?: PersonQuote[] }> {
  if (!isUuid(workspaceId) || !isUuid(personId))
    return { error: "That link is not valid." };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).GET("/v1/workspaces/{workspaceId}/quotes", {
        params: {
          path: { workspaceId },
          query: { personId, limit: 10 },
        },
      }),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  return {
    quotes: res.value.quotes.map((q) => ({
      kind: q.kind,
      id: q.id,
      text: q.text,
      sourceItemId: q.sourceItemId,
      sourceTitle: q.sourceTitle,
      sourceKind: q.sourceKind,
      at: q.at,
      requestId: q.requestId,
      requestTitle: q.requestTitle,
    })),
  };
}

/** Folds one person into another, then deletes the first. Admin only; the API refuses if a send record would be lost. */
export async function mergePersonAction(
  workspaceId: string,
  sourceId: string,
  targetId: string,
): Promise<{ error?: string; notice?: string }> {
  if (!isUuid(workspaceId) || !isUuid(sourceId) || !isUuid(targetId))
    return { error: badMessage };
  if (sourceId === targetId) return { error: "Choose two different people." };
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/people/merge", {
        params: { path: { workspaceId } },
        body: { sourceId, targetId },
      }),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  revalidatePath(`/w/${workspaceId}/people`);
  revalidatePath(`/w/${workspaceId}/quotes`);
  revalidatePath(`/w/${workspaceId}/findings`);
  return { notice: "People merged." };
}

/**
 * Deletes several people, one at a time so one failure does not stop the rest.
 * Admins only: the API enforces it, and the caller explains what goes first.
 */
export async function deletePeopleAction(
  workspaceId: string,
  ids: string[],
): Promise<{ error?: string; notice?: string }> {
  if (!isUuid(workspaceId) || ids.length === 0 || ids.length > 50)
    return { error: badMessage };
  if (!ids.every(isUuid)) return { error: badMessage };
  const client = await api();
  let deleted = 0;
  let failed = 0;
  for (const id of ids) {
    const res = await attempt(async () =>
      unwrapEmpty(
        await client.DELETE("/v1/workspaces/{workspaceId}/people/{personId}", {
          params: { path: { workspaceId, personId: id } },
        }),
      ),
    );
    if (res.ok) deleted++;
    else failed++;
  }
  revalidatePath(`/w/${workspaceId}/people`);
  revalidatePath(`/w/${workspaceId}/quotes`);
  if (deleted === 0) return { error: "None of those people could be deleted." };
  return {
    notice:
      failed > 0
        ? `Deleted ${deleted}; ${failed} could not be deleted.`
        : `Deleted ${deleted} ${deleted === 1 ? "person" : "people"}.`,
  };
}

/** Folds one company into another and deletes the first. Admin only; people and saved views move. */
export async function mergeAccountsAction(
  workspaceId: string,
  sourceId: string,
  targetId: string,
): Promise<{ error?: string; notice?: string }> {
  if (!isUuid(workspaceId) || !isUuid(sourceId) || !isUuid(targetId))
    return { error: badMessage };
  if (sourceId === targetId) return { error: "Choose two different companies." };
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/accounts/merge", {
        params: { path: { workspaceId } },
        body: { sourceId, targetId },
      }),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  revalidatePath(`/w/${workspaceId}/people`);
  revalidatePath(`/w/${workspaceId}/quotes`);
  return { notice: "Companies merged." };
}

export type AccountPerson = {
  id: string;
  name: string;
  email?: string;
  quoteCount: number;
  lastHeardAt?: string;
};

/** The people at one company, for its side panel. */
export async function accountPeopleAction(
  workspaceId: string,
  accountId: string,
): Promise<{ error?: string; people?: AccountPerson[] }> {
  if (!isUuid(workspaceId) || !isUuid(accountId))
    return { error: "That link is not valid." };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).GET("/v1/workspaces/{workspaceId}/people", {
        params: {
          path: { workspaceId },
          query: { accountId, limit: 50 },
        },
      }),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  return {
    people: res.value.people.map((p) => ({
      id: p.id,
      name: p.name,
      email: p.email,
      quoteCount: p.quoteCount ?? 0,
      lastHeardAt: p.lastHeardAt,
    })),
  };
}

/** Looks the company up on the public web. Returns the answer so the drawer can show it at once. */
export async function researchAccountAction(
  workspaceId: string,
  accountId: string,
): Promise<{
  summary?: string;
  checkedAt?: string;
  sources?: { title: string; url: string; snippet: string }[];
  error?: string;
}> {
  if (!isUuid(workspaceId) || !isUuid(accountId))
    return { error: "That link is not valid. Go back and try again." };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/accounts/{accountId}/research", {
        params: { path: { workspaceId, accountId } },
      }),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  revalidatePath(`/w/${workspaceId}/people`);
  return {
    summary: res.value.summary,
    checkedAt: res.value.checkedAt,
    sources: res.value.sources.map((s) => ({
      title: s.title,
      url: s.url,
      snippet: s.snippet,
    })),
  };
}
