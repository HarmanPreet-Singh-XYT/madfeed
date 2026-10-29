"use server";

import { revalidatePath } from "next/cache";
import { api, unwrap, unwrapEmpty } from "@/lib/server/api";
import { attempt, type FormState } from "@/lib/server/actions-util";
import { isUuid } from "@/lib/text";

const BAD_LINK = "That link is not valid. Go back and try again.";

export async function saveViewAction(
  workspaceId: string,
  _prev: FormState | { notice: string } | undefined,
  formData: FormData,
): Promise<{ error?: string; notice?: string }> {
  if (!isUuid(workspaceId)) return { error: BAD_LINK };
  const name = String(formData.get("name") ?? "").trim();
  const status = String(formData.get("status") ?? "");
  const tag = String(formData.get("tag") ?? "");
  const q = String(formData.get("q") ?? "").trim();
  const sort = formData.get("sort") === "value" ? "value" : "newest";
  if (!name) return { error: "Give the view a name." };
  if ((status && !isUuid(status)) || (tag && !isUuid(tag)))
    return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).POST("/v1/workspaces/{workspaceId}/views", {
        params: { path: { workspaceId } },
        body: {
          name,
          sort,
          ...(status ? { statusId: status } : {}),
          ...(tag ? { tagId: tag } : {}),
          ...(q ? { q: q.slice(0, 100) } : {}),
        },
      }),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  revalidatePath(`/w/${workspaceId}/requests`);
  return { notice: `Saved “${res.value.name}”.` };
}

/**
 * Renames a view and/or replaces the filters it stands for. Called from the
 * saved-view menu; the API checks that the caller made the view or is an admin.
 */
export async function updateViewFields(
  workspaceId: string,
  viewId: string,
  input: { name: string; status: string; tag: string; q: string; sort: string },
): Promise<{ error?: string; notice?: string }> {
  if (!isUuid(workspaceId) || !isUuid(viewId)) return { error: BAD_LINK };
  const name = input.name.trim();
  if (!name) return { error: "Give the view a name." };
  if (
    (input.status && !isUuid(input.status)) ||
    (input.tag && !isUuid(input.tag))
  )
    return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrap(
      await (
        await api()
      ).PUT("/v1/workspaces/{workspaceId}/views/{viewId}", {
        params: { path: { workspaceId, viewId } },
        body: {
          name,
          sort: input.sort === "value" ? "value" : "newest",
          ...(input.status ? { statusId: input.status } : {}),
          ...(input.tag ? { tagId: input.tag } : {}),
          ...(input.q ? { q: input.q.slice(0, 100) } : {}),
        },
      }),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  revalidatePath(`/w/${workspaceId}/requests`);
  return { notice: `Updated “${res.value.name}”.` };
}

export async function deleteViewAction(
  workspaceId: string,
  viewId: string,
): Promise<{ error?: string }> {
  if (!isUuid(workspaceId) || !isUuid(viewId)) return { error: BAD_LINK };
  const res = await attempt(async () =>
    unwrapEmpty(
      await (
        await api()
      ).DELETE("/v1/workspaces/{workspaceId}/views/{viewId}", {
        params: { path: { workspaceId, viewId } },
      }),
    ),
  );
  if (!res.ok) return { error: res.state?.error };
  revalidatePath(`/w/${workspaceId}/requests`);
  return {};
}
