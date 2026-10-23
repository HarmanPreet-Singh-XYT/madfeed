"use server";

import { redirect } from "next/navigation";
import { clearToken, setRefreshToken, setToken } from "@/lib/server/session";
import { devAuthEnabled, fetchDevToken } from "@/lib/server/dev-auth";
import {
  signInWithPassword,
  signUpWithPassword,
  supabaseConfigured,
} from "@/lib/server/supabase-auth";
import type { FormState } from "@/lib/server/actions-util";
import { safeNext } from "@/lib/next-path";

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
  redirect(safeNext(formData.get("next")));
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
  if (res.refreshToken) await setRefreshToken(res.refreshToken);
  redirect(safeNext(formData.get("next")));
}

export type SignUpState =
  { error?: string; confirm?: boolean; email?: string } | undefined;

/** Creates an account. Either signs the person straight in, or tells them to confirm their email. */
export async function signUp(
  _prev: SignUpState,
  formData: FormData,
): Promise<SignUpState> {
  if (!supabaseConfigured()) return { error: "Sign-up isn't available yet." };
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const again = String(formData.get("password2") ?? "");
  if (!EMAIL.test(email) || email.length > 320)
    return { error: "Enter your email address.", email };
  if (password.length < 10 || password.length > 72)
    return { error: "Choose a password of 10 to 72 characters.", email };
  if (password !== again)
    return { error: "The two passwords don't match.", email };
  const res = await signUpWithPassword(email, password);
  if (!res.ok) return { error: res.message, email };
  if (!res.session) return { confirm: true };
  await setToken(
    res.session.token,
    Math.min(res.session.expiresInSeconds, 8 * 60 * 60),
  );
  if (res.session.refreshToken) await setRefreshToken(res.session.refreshToken);
  redirect(safeNext(formData.get("next")));
}

export async function signOut(): Promise<void> {
  await clearToken();
  redirect("/login");
}
