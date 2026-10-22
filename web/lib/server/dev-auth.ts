import "server-only";
import { createHash } from "node:crypto";

// Local development only: gets a token from `make devauth`. It is OFF unless
// ENABLE_DEV_AUTH=true is set explicitly, and it is refused outright when
// APP_ENV=production, so a deployment cannot offer it by accident.
const devAuthUrl = () => process.env.DEV_AUTH_URL ?? "http://127.0.0.1:9999";

export function devAuthEnabled(): boolean {
  return (
    process.env.ENABLE_DEV_AUTH === "true" &&
    process.env.APP_ENV !== "production"
  );
}

/** A stable user id for a dev name, so "alice" is the same person every time. */
export function devUserId(name: string): string {
  const h = createHash("sha1")
    .update(`dev-user:${name.trim().toLowerCase()}`)
    .digest("hex");
  // Shape it as a version-5 UUID.
  const variant = ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

export async function fetchDevToken(name: string): Promise<string> {
  if (!devAuthEnabled()) throw new Error("Dev sign-in is not enabled");
  const res = await fetch(`${devAuthUrl()}/token?sub=${devUserId(name)}`, {
    cache: "no-store",
  });
  if (!res.ok)
    throw new Error("The local sign-in service is not running (make devauth)");
  const body = (await res.json()) as { token?: string };
  if (!body.token)
    throw new Error("The local sign-in service returned no token");
  return body.token;
}
