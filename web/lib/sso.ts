import { createHash, randomBytes } from "node:crypto";

// Pure helpers for signing in through a company's own identity system. The identity service (Supabase) does the
// talking to the company's identity system; this app only starts the trip and finishes it with a one-time code,
// proving with a secret it made (PKCE) that it is the same browser that started.

/** Identity providers that can be offered as buttons. Anything else in the setting is ignored. */
export const KNOWN_PROVIDERS: Record<string, string> = {
  google: "Google",
  azure: "Microsoft",
  github: "GitHub",
  gitlab: "GitLab",
  keycloak: "Keycloak",
  workos: "WorkOS",
};

export function parseProviders(raw: string | undefined): string[] {
  const out: string[] = [];
  for (const p of (raw ?? "").split(",")) {
    const k = p.trim().toLowerCase();
    if (k in KNOWN_PROVIDERS && !out.includes(k)) out.push(k);
  }
  return out;
}

const DOMAIN =
  /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** The part of a work email after the @, if it looks like a real domain. */
export function domainOf(email: string): string | undefined {
  const at = email.trim().toLowerCase().split("@");
  if (at.length !== 2 || !/^[^\s@]{1,64}$/.test(at[0])) return undefined;
  return DOMAIN.test(at[1]) ? at[1] : undefined;
}

export function newVerifier(): string {
  return randomBytes(48).toString("base64url"); // 64 characters, within the 43 to 128 PKCE allows
}

export function challengeOf(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** A one-time code from the identity service: letters, digits and a few separators, short. */
export function validCode(code: unknown): code is string {
  return typeof code === "string" && /^[A-Za-z0-9._~-]{8,300}$/.test(code);
}

export function validVerifier(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{43,128}$/.test(v);
}
