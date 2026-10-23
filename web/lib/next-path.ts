/**
 * Where to send a person after they sign in. Only the public roadmap pages qualify, so a
 * crafted link can never bounce someone to another site or into an arbitrary page.
 */
const ALLOWED = /^\/r\/[a-z0-9][a-z0-9-]{2,39}\/roadmap$/;

export function safeNext(value: unknown): string {
  return typeof value === "string" && ALLOWED.test(value) ? value : "/";
}
