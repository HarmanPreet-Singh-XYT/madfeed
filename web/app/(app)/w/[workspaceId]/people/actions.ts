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
