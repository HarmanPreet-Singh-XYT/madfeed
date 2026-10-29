"use server";

import { redirect } from "next/navigation";
import { publicApi } from "@/lib/server/api";
import type { FormState } from "@/lib/server/actions-util";

export async function unlockFindingAction(
  token: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const password = String(formData.get("password") ?? "");
  if (!password) return { error: "Enter the password." };
  const res = await publicApi().POST("/v1/public/findings/{token}/unlock", {
    params: { path: { token } },
    body: { password },
  });
  if (res.response.status === 401) {
    return { error: "That password does not match." };
  }
  if (!res.data) {
    return { error: "This link could not be opened. Ask for a new one." };
  }
  redirect(`/f/${token}?grant=${encodeURIComponent(res.data.grant)}`);
}
