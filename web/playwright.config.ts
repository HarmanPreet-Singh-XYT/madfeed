import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run the real stack locally: the Go API against the Docker
// database, the local token service, and a production build of the web app.
// Prepare the database first: `make dev-db migrate dev-role` (or `make e2e`).
const API = "http://127.0.0.1:18080";
const DB =
  "postgres://app_api:dev-api-password@127.0.0.1:54322/app?sslmode=disable";
const SECRETS = {
  UNSUBSCRIBE_SECRET: "e2e-unsubscribe-secret-of-32-characters!!",
  PUBLIC_BASE_URL: "http://127.0.0.1:13000",
};
const WEB = "http://127.0.0.1:13000";
// Recordings uploaded during tests live here (the API and the worker must agree); the specs read it too.
const MEDIA = join(tmpdir(), "feedback-e2e-media");
const FAKE_AI = {
  AI_CONFIG: "config/ai.dev.json",
  OPENAI_API_KEY: "dev-key",
  OPENAI_BASE_URL: "http://127.0.0.1:9997/v1",
  TRANSCRIBE_BASE_URL: "http://127.0.0.1:9997/v1",
  MEDIA_DIR: MEDIA,
};

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000, // the long end-to-end flows take a while
  globalSetup: "./e2e/global-setup.ts",
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
      // Password-grant tokens live 100 s here (not an hour), so a test can watch a session being renewed.
      env: { DEVAUTH_PASSWORD_TTL: "100" },
    },
    {
      command: "go run ./cmd/devmail",
      cwd: "../api",
      url: "http://127.0.0.1:9998/outbox",
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      // A fake AI provider speaking the OpenAI protocol, so the real model adapter and answer checks run without a key.
      command: "go run ./cmd/devmodel",
      cwd: "../api",
      url: "http://127.0.0.1:9997/v1/models",
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      // The real worker: drafts plain messages (no AI key here) and sends approved mail to the local mail stand-in.
      command: "go run ./cmd/server",
      cwd: "../api",
      url: "http://127.0.0.1:18081/healthz",
      reuseExistingServer: true,
      timeout: 120_000,
      env: {
        APP_ENV: "development",
        APP_MODE: "worker",
        ADDR: "127.0.0.1:18081",
        DATABASE_URL: DB,
        RESEND_API_KEY: "dev-key",
        RESEND_BASE_URL: "http://127.0.0.1:9998",
        EMAIL_FROM_ADDRESS: "updates@mail.dev.local",
        WORKER_QUEUES: "default",
        ...SECRETS,
      },
    },
    {
      // The research worker: transcribes recordings and suggests highlights using the fake provider.
      command: "go run ./cmd/server",
      cwd: "../api",
      url: "http://127.0.0.1:18082/healthz",
      reuseExistingServer: true,
      timeout: 120_000,
      env: {
        APP_ENV: "development",
        APP_MODE: "worker",
        ADDR: "127.0.0.1:18082",
        DATABASE_URL: DB,
        WORKER_QUEUES: "research",
        ...FAKE_AI,
        ...SECRETS,
      },
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
        DATABASE_URL: DB,
        SUPABASE_JWKS_URL: "http://127.0.0.1:9999/jwks.json",
        JWT_ISSUER: "http://localhost:9999",
        ...FAKE_AI,
        ...SECRETS,
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
    {
      // A second copy of the same build with the development sign-in OFF and real email-and-password
      // sign-in pointed at the local stand-in for Supabase, so the production login path is exercised.
      command: "npm run start -- -p 13001 -H 127.0.0.1",
      url: "http://127.0.0.1:13001/login",
      reuseExistingServer: true,
      timeout: 300_000,
      env: {
        API_URL: API,
        SUPABASE_URL: "http://127.0.0.1:9999",
        SUPABASE_PUBLISHABLE_KEY: "sb_publishable_dev",
      },
    },
  ],
});
