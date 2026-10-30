"use server";

import { redirect } from "next/navigation";
import {
  clearToken,
  getToken,
  setRefreshToken,
  setToken,
} from "@/lib/server/session";
import { devAuthEnabled, fetchDevToken } from "@/lib/server/dev-auth";
import {
  requestPasswordReset,
  signInWithPassword,
  signUpWithPassword,
  supabaseConfigured,
  updatePassword,
  verifyRecovery,
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

export type SignInState = { error?: string; email?: string } | undefined;

/** Signs in with an email and password. A failed attempt gives the address back, so the form keeps it. */
export async function signInWithEmail(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  if (!supabaseConfigured()) return { error: "Sign-in is not available yet." };
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!EMAIL.test(email) || email.length > 320)
    return { error: "Enter the email address you signed up with.", email };
  if (!password || password.length > 200)
    return { error: "Enter your password.", email };
  const res = await signInWithPassword(email, password);
  if (!res.ok) return { error: res.message, email };
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

export type ResetRequestState =
  | { error?: string; sent?: boolean; email?: string }
  | undefined;

/** Emails a reset link. The same answer is given for every address. */
export async function requestReset(
  _prev: ResetRequestState,
  formData: FormData,
): Promise<ResetRequestState> {
  if (!supabaseConfigured())
    return { error: "Password reset isn't available yet." };
  const email = String(formData.get("email") ?? "").trim();
  if (!EMAIL.test(email) || email.length > 320)
    return { error: "Enter the email address you signed up with." };
  const res = await requestPasswordReset(email);
  return res.ok ? { sent: true, email } : { error: res.message };
}

const TOKEN_HASH = /^[A-Za-z0-9_-]{8,200}$/;

/** Uses the code from a reset email to set a new password, then signs the person in. */
export async function completeReset(
  tokenHash: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!supabaseConfigured())
    return { error: "Password reset isn't available yet." };
  if (!TOKEN_HASH.test(tokenHash))
    return { error: "This reset link isn't valid. Ask for a new one." };
  const password = String(formData.get("password") ?? "");
  const again = String(formData.get("password2") ?? "");
  if (password.length < 10 || password.length > 72)
    return { error: "Choose a password of 10 to 72 characters." };
  if (password !== again) return { error: "The two passwords don't match." };
  const session = await verifyRecovery(tokenHash);
  if (!session.ok) return { error: session.message };
  const changed = await updatePassword(session.token, password);
  if (!changed.ok) return { error: changed.message };
  await setToken(
    session.token,
    Math.min(session.expiresInSeconds, 8 * 60 * 60),
  );
  if (session.refreshToken) await setRefreshToken(session.refreshToken);
  redirect("/home");
}

export type ChangePasswordState =
  { error?: string; done?: boolean } | undefined;

function emailOf(token: string): string | undefined {
  try {
    const part = token.split(".")[1] ?? "";
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    const email = (JSON.parse(json) as { email?: unknown }).email;
    return typeof email === "string" ? email : undefined;
  } catch {
    return undefined;
  }
}

/** Changes the signed-in person's password. The current password is checked first, so a borrowed session is not enough. */
export async function changePassword(
  _prev: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  if (!supabaseConfigured())
    return { error: "Changing your password isn't available yet." };
  const token = await getToken();
  const email = token ? emailOf(token) : undefined;
  if (!email) return { error: "Please sign in again, then try once more." };
  const current = String(formData.get("current") ?? "");
  const password = String(formData.get("password") ?? "");
  const again = String(formData.get("password2") ?? "");
  if (!current || current.length > 200)
    return { error: "Enter your current password." };
  if (password.length < 10 || password.length > 72)
    return { error: "Choose a password of 10 to 72 characters." };
  if (password !== again) return { error: "The two passwords don't match." };
  const proof = await signInWithPassword(email, current);
  if (!proof.ok) return { error: "Your current password isn't right." };
  const res = await updatePassword(proof.token, password);
  if (!res.ok) return { error: res.message };
  return { done: true };
}
