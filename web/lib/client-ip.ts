import { isIP } from "node:net";

/**
 * The visitor's address from X-Forwarded-For, trusting only the proxies we run in front of this app.
 * With `hops` of 0 nothing in the header can be trusted (anyone can send it), so there is no answer.
 * With `hops` of N, the right-most N entries were added by our own proxies and the one before them is the visitor.
 */
export function clientIp(
  forwardedFor: string | null | undefined,
  hops: number,
): string | undefined {
  if (!forwardedFor || !Number.isInteger(hops) || hops < 1) return undefined;
  const parts = forwardedFor.split(",").map((p) => p.trim());
  const ip = parts[parts.length - hops];
  return ip && isIP(ip) ? ip : undefined;
}
