"use server";

import { redirect } from "next/navigation";
import { api, unwrap } from "@/lib/server/api";
import { attempt, type FormState } from "@/lib/server/actions-util";

export async function createWorkspace(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name || name.length > 200)
    return { error: "Give your workspace a name (up to 200 characters)." };
  const res = await attempt(async () =>
    unwrap(await (await api()).POST("/v1/workspaces", { body: { name } })),
  );
  if (!res.ok) return res.state;
  redirect(`/w/${res.value.id}/add`);
}
