import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run the real stack locally: the Go API against the Docker
// database, the local token service, and a production build of the web app.
// Prepare the database first: `make dev-db migrate dev-role` (or `make e2e`).
const API = "http://127.0.0.1:18080";
const WEB = "http://127.0.0.1:13000";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: WEB, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    {
      command: "go run ./cmd/devauth",
      cwd: "../api",
      url: "http://127.0.0.1:9999/jwks.json",
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: "go run ./cmd/server",
      cwd: "../api",
      url: `${API}/healthz`,
      reuseExistingServer: true,
      timeout: 120_000,
      env: {
        APP_ENV: "development",
        ADDR: "127.0.0.1:18080",
        ALLOWED_ORIGINS: WEB,
        DATABASE_URL:
          "postgres://app_api:dev-api-password@127.0.0.1:54322/app?sslmode=disable",
        SUPABASE_JWKS_URL: "http://127.0.0.1:9999/jwks.json",
        JWT_ISSUER: "http://localhost:9999",
      },
    },
    {
      command: "npm run build && npm run start -- -p 13000 -H 127.0.0.1",
      url: `${WEB}/login`,
      reuseExistingServer: true,
      timeout: 300_000,
      env: {
        API_URL: API,
        DEV_AUTH_URL: "http://127.0.0.1:9999",
        ENABLE_DEV_AUTH: "true",
      },
    },
  ],
});
