"use server";

import { redirect } from "next/navigation";
import { clearToken, setToken } from "@/lib/server/session";
import { devAuthEnabled, fetchDevToken } from "@/lib/server/dev-auth";
import {
  signInWithPassword,
  supabaseConfigured,
} from "@/lib/server/supabase-auth";
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

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}$/;

export async function signInWithEmail(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!supabaseConfigured()) return { error: "Sign-in is not available yet." };
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!EMAIL.test(email) || email.length > 320)
    return { error: "Enter the email address you signed up with." };
  if (!password || password.length > 200)
    return { error: "Enter your password." };
  const res = await signInWithPassword(email, password);
  if (!res.ok) return { error: res.message };
  await setToken(res.token, Math.min(res.expiresInSeconds, 8 * 60 * 60));
  redirect("/");
}

export async function signOut(): Promise<void> {
  await clearToken();
  redirect("/login");
}
