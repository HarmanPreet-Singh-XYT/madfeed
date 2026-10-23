"use server";

import { revalidatePath } from "next/cache";
import { api, unwrapEmpty } from "@/lib/server/api";
import { attempt, type FormState } from "@/lib/server/actions-util";
import { isUuid } from "@/lib/text";

const SLUG = /^[a-z0-9][a-z0-9-]{2,39}$/;

/** Casts or takes back the signed-in person's vote for one request on a public roadmap. */
export async function voteAction(
  slug: string,
  requestId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!SLUG.test(slug) || !isUuid(requestId))
    return { error: "That link is not valid." };
  const remove = formData.get("intent") === "remove";
  const res = await attempt(async () => {
    const client = await api();
    const params = { params: { path: { slug, requestId } } };
    return unwrapEmpty(
      remove
        ? await client.DELETE(
            "/v1/sites/{slug}/requests/{requestId}/vote",
            params,
          )
        : await client.PUT(
            "/v1/sites/{slug}/requests/{requestId}/vote",
            params,
          ),
    );
  });
  if (!res.ok) return res.state;
  revalidatePath(`/r/${slug}/roadmap`);
  return undefined;
}
