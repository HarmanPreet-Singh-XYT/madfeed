"use server";

import { redirect } from "next/navigation";
import type { FormState } from "@/lib/server/actions-util";
import { safeNext } from "@/lib/next-path";
import { challengeOf, domainOf, newVerifier, parseProviders } from "@/lib/sso";
import {
  providerUrl,
  rememberTrip,
  ssoEnabled,
  ssoUrlForDomain,
} from "@/lib/server/sso";

/** Starts company sign-in from a work email address. */
export async function startCompanySignIn(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!ssoEnabled()) return { error: "Company sign-in isn't available." };
  const domain = domainOf(String(formData.get("email") ?? ""));
  if (!domain) return { error: "Enter your work email address." };
  const verifier = newVerifier();
  const r = await ssoUrlForDomain(domain, challengeOf(verifier));
  if ("error" in r) return { error: r.error };
  await rememberTrip(verifier, safeNext(formData.get("next")));
  redirect(r.url);
}

/** Starts sign-in with one of the offered providers (for example Google). */
export async function startProviderSignIn(formData: FormData): Promise<void> {
  const provider = String(formData.get("provider") ?? "");
  if (
    !ssoEnabled() ||
    !parseProviders(process.env.SSO_PROVIDERS).includes(provider)
  )
    redirect("/login");
  const verifier = newVerifier();
  await rememberTrip(verifier, safeNext(formData.get("next")));
  redirect(providerUrl(provider, challengeOf(verifier)));
}
