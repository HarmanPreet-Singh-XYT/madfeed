import { describe, expect, it } from "vitest";
import { createApiClient } from "./client";

// Runs only when a real API is up: API_URL=http://localhost:8080 npm test
const live = process.env.API_URL ? describe : describe.skip;

live("generated client against the live API", () => {
  it("reads /healthz with typed fields", async () => {
    const { data, error, response } = await createApiClient().GET("/healthz");
    expect(error).toBeUndefined();
    expect(response.status).toBe(200);
    expect(data?.status).toBe("ok");
    expect(typeof data?.version).toBe("string");
  });
});
