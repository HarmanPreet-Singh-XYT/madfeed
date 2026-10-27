import "server-only";

// Stands in for lib/server/auth-transport.ts in a preview build: a pretend sign-in service, so the sign-in,
// sign-up and password-reset screens work end to end with no account.
//
//   any email and password        signs in
//   password "wrong"              shows the wrong-password message
//   email starting "unconfirmed"  shows the confirm-your-email message
//   sign-up email starting "confirm"  shows the check-your-email step
//   reset code starting "expired"  shows the expired-link message

export type AuthService = { base: string; key: string };
export function authService(): AuthService | undefined {
  return { base: "http://auth.mock.invalid", key: "mock-key" };
}

const b64 = (o: unknown) =>
  Buffer.from(JSON.stringify(o)).toString("base64url");
/** A well-formed token that does not expire for years, so nothing tries to renew it. */
function session(email: string) {
  const exp = Math.floor(Date.now() / 1000) + 10 * 365 * 86_400;
  return {
    access_token: `${b64({ alg: "none" })}.${b64({ sub: "00000000-0000-4000-8000-0000000000a1", email, exp })}.sig`,
    refresh_token: "mock-refresh",
    expires_in: 3600,
  };
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export const authFetch: typeof fetch = async (input, init) => {
  const req = input instanceof Request ? input : new Request(input, init);
  const url = new URL(req.url);
  const body = (await req
    .clone()
    .json()
    .catch(() => ({}))) as Record<string, string>;
  await new Promise((r) => setTimeout(r, 200));
  const path = url.pathname;
  if (
    path === "/auth/v1/token" &&
    url.searchParams.get("grant_type") === "password"
  ) {
    if (body.password === "wrong")
      return json({ error_code: "invalid_credentials" }, 400);
    if ((body.email ?? "").startsWith("unconfirmed"))
      return json({ error_code: "email_not_confirmed" }, 400);
    return json(session(body.email ?? "demo@northwind.example"));
  }
  if (path === "/auth/v1/signup")
    return (body.email ?? "").startsWith("confirm")
      ? json({})
      : json(session(body.email));
  if (path === "/auth/v1/recover") return json({});
  if (path === "/auth/v1/verify")
    return (body.token_hash ?? "").startsWith("expired")
      ? json({ error_code: "otp_expired" }, 403)
      : json(session("demo@northwind.example"));
  if (path === "/auth/v1/user" && req.method === "PUT")
    return (body.password ?? "").length < 10
      ? json({ error_code: "weak_password" }, 422)
      : json({});
  return json({ error_code: "not_available" }, 400); // company sign-in is not part of the preview
};
