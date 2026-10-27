import "server-only";
import { getToken } from "./session";

// The one place the web app learns how to reach the API and who is signed in. Every server-side call goes
// through these three exports. A preview build for design work swaps this file for mock/transport.ts at build
// time (see next.config.ts), so nothing else in the app has to know there is such a thing.
// Always import this as "@/lib/server/transport", the swap matches that exact name.

/** The API's address. */
export const apiBase = process.env.API_URL ?? "http://127.0.0.1:8080";

/** Sends a request to the API. */
export const apiFetch: typeof fetch = (input, init) => fetch(input, init);

/** The signed-in person's access token, or undefined when nobody is signed in. */
export const sessionToken: () => Promise<string | undefined> = getToken;
