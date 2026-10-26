"use server";

import { revalidatePath } from "next/cache";
import { api, publicApi, toApiError, unwrapEmpty } from "@/lib/server/api";
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

const TOKEN = /^v1\.[A-Za-z0-9_-]{1,500}\.[A-Za-z0-9_-]{1,100}$/;

/** Votes as someone the company's own app vouched for (a signed link): no account needed. */
export async function signedVoteAction(
  slug: string,
  requestId: string,
  token: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!SLUG.test(slug) || !isUuid(requestId) || !TOKEN.test(token))
    return { error: "That link is not valid." };
  const res = await publicApi().POST(
    "/v1/public/sites/{slug}/requests/{requestId}/signed-vote",
    {
      params: { path: { slug, requestId } },
      body: { token, remove: formData.get("intent") === "remove" },
    },
  );
  if (res.response.status === 404)
    return {
      error:
        "This voting link has expired. Open the roadmap again from the app.",
    };
  if (!res.response.ok)
    return { error: toApiError(res.response.status, res.error).message };
  revalidatePath(`/r/${slug}/roadmap`);
  return undefined;
}

export type EraseVotesState = { error?: string; removed?: number } | undefined;

/** Removes every vote the signed-in person has cast, on every public roadmap. */
export async function eraseMyVotesAction(
  slug: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- useActionState passes the previous state
  _prev: EraseVotesState,
): Promise<EraseVotesState> {
  if (!SLUG.test(slug)) return { error: "That link is not valid." };
  const res = await attempt(async () => {
    const r = await (await api()).DELETE("/v1/votes");
    if (!r.response.ok) throw toApiError(r.response.status, r.error);
    return r.data?.removed ?? 0;
  });
  if (!res.ok) return res.state;
  revalidatePath(`/r/${slug}/roadmap`);
  return { removed: res.value };
}
