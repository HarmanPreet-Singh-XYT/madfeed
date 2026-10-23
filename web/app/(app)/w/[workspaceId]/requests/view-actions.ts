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
