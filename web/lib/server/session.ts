import "server-only";
import { cookies } from "next/headers";

// The access token lives in an httpOnly cookie, so page JavaScript never sees
// it. Server components and server actions read it here and call the API.
const COOKIE = "session";
const EIGHT_HOURS = 8 * 60 * 60;

export async function getToken(): Promise<string | undefined> {
  return (await cookies()).get(COOKIE)?.value;
}

export async function setToken(
  token: string,
  maxAgeSeconds = EIGHT_HOURS,
): Promise<void> {
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSeconds,
  });
}

const REFRESH = "refresh";
const THIRTY_DAYS = 30 * 24 * 60 * 60;

export async function setRefreshToken(token: string): Promise<void> {
  (await cookies()).set(REFRESH, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: THIRTY_DAYS,
  });
}

export async function clearToken(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
  jar.delete(REFRESH);
}
