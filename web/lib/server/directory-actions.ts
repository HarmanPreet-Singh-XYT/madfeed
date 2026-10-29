"use server";

import { api, unwrap } from "@/lib/server/api";
import { attempt } from "@/lib/server/actions-util";
import { isUuid } from "@/lib/text";

export type DirectoryOption = { id: string; name: string; email?: string; hint?: string };

/** People whose name or email matches, for a person filter. Read-only: filtering never creates a person. */
export async function searchPeopleAction(
  workspaceId: string,
  q: string,
): Promise<DirectoryOption[]> {
  if (!isUuid(workspaceId)) return [];
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).GET("/v1/workspaces/{workspaceId}/people", {
        params: {
          path: { workspaceId },
          query: { q: q.trim().slice(0, 200) || undefined, limit: 8 },
        },
      }),
    ),
  );
  if (!res.ok) return [];
  return res.value.people.map((p) => ({
    id: p.id,
    name: p.name,
    email: p.email,
    hint: p.accountName,
  }));
}

export async function searchAccountsAction(
  workspaceId: string,
  q: string,
): Promise<DirectoryOption[]> {
  if (!isUuid(workspaceId)) return [];
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).GET("/v1/workspaces/{workspaceId}/accounts", {
        params: {
          path: { workspaceId },
          query: { q: q.trim().slice(0, 200) || undefined, limit: 8 },
        },
      }),
    ),
  );
  if (!res.ok) return [];
  return res.value.accounts.map((a) => ({ id: a.id, name: a.name }));
}
