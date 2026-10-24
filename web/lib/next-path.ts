/**
 * Where to send a person after they sign in. Only the public roadmap pages and the approval page
 * for connecting an AI assistant qualify, so a crafted link can never bounce someone to another
 * site or into an arbitrary page.
 */
const ALLOWED = [
  /^\/r\/[a-z0-9][a-z0-9-]{2,39}\/roadmap$/,
  // the assistant's own request, kept whole so signing in does not lose it
  /^\/oauth\/authorize\?[A-Za-z0-9_.~%=&+-]{1,3000}$/,
];

export function safeNext(value: unknown): string {
  return typeof value === "string" && ALLOWED.some((re) => re.test(value))
    ? value
    : "/";
}
