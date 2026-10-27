import "server-only";

// The one place the web app learns how to reach the sign-in service (Supabase Auth). Sign-in, sign-up, password
// reset and company sign-in all go through these two exports. A preview build swaps this file for
// mock/auth-transport.ts (see next.config.ts). Always import it as "@/lib/server/auth-transport".

export type AuthService = { base: string; key: string };

/** Where the sign-in service is and the public key to call it with, or undefined when it is not set up. */
export function authService(): AuthService | undefined {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { base: url.replace(/\/+$/, ""), key } : undefined;
}

/** Sends a request to the sign-in service. */
export const authFetch: typeof fetch = (input, init) => fetch(input, init);
