"use server";

import { redirect } from "next/navigation";
import { clearToken, setToken } from "@/lib/server/session";
import { devAuthEnabled, fetchDevToken } from "@/lib/server/dev-auth";
import type { FormState } from "@/lib/server/actions-util";

export async function signIn(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!devAuthEnabled()) return { error: "Sign-in is not available yet." };
  const name = String(formData.get("name") ?? "").trim();
  if (!name || name.length > 60)
    return { error: "Enter a name between 1 and 60 characters." };
  try {
    await setToken(await fetchDevToken(name));
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not sign in." };
  }
  redirect("/");
}

export async function signOut(): Promise<void> {
  await clearToken();
  redirect("/login");
}
