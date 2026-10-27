import "server-only";
import { publicApi, toApiError } from "./api";
import { isUuid } from "@/lib/text";

// Release notes anyone may read. They are read fresh every time, on purpose: a page that is kept in a web
// instance's memory cannot promise that the person who has just published (or taken down) a note sees that
// change, because their next request may reach another instance. The API answers cheaply and its public
// endpoints are rate limited. The slug and id are checked first so junk addresses never reach the API.
const SLUG = /^[a-z0-9][a-z0-9-]{2,39}$/;

export async function getPublicReleases(slug: string) {
  if (!SLUG.test(slug)) return null;
  const res = await publicApi().GET("/v1/public/releases/{slug}", {
    params: { path: { slug }, query: { limit: 50 } },
    cache: "no-store",
  });
  if (res.response.status === 404) return null;
  if (!res.data) throw toApiError(res.response.status, res.error);
  return res.data;
}

export async function getPublicNote(slug: string, noteId: string) {
  if (!SLUG.test(slug) || !isUuid(noteId)) return null;
  const res = await publicApi().GET("/v1/public/releases/{slug}/{noteId}", {
    params: { path: { slug, noteId } },
    cache: "no-store",
  });
  if (res.response.status === 404) return null;
  if (!res.data) throw toApiError(res.response.status, res.error);
  return res.data;
}
