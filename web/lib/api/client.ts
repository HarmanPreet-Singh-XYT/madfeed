import createClient from "openapi-fetch";
import { apiBaseUrl } from "@/lib/env";
import type { paths } from "./schema.gen";

// Typed client generated from api/openapi.yaml. Never hand-edit schema.gen.d.ts;
// run `npm run generate:api` after the contract changes.
export function createApiClient(accessToken?: string) {
  return createClient<paths>({
    baseUrl: apiBaseUrl,
    headers: accessToken
      ? { Authorization: `Bearer ${accessToken}` }
      : undefined,
  });
}
