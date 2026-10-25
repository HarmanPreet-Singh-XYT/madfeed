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
  // All test traffic comes from one address, so the per-address limit would trip on busy runs.
  RATE_PUBLIC_PER_MINUTE: "5000",
  RATE_REGISTER_PER_HOUR: "5000",
};
const WEB = "http://127.0.0.1:13000";
// Connections: stand-ins for Slack, GitHub and Stripe, and the settings that point the API at them.
const BILLING_API = "http://127.0.0.1:18083";
const BILLING_WEB = "http://127.0.0.1:13003";
const CONNECTIONS = {
  SECRETS_KEY: "ZTJlLXNlY3JldHMta2V5LXRoaXJ0eS10d28tYnl0ZXM=", // 32 bytes, for tests only
  SLACK_CLIENT_ID: "e2e-slack-client",
  SLACK_CLIENT_SECRET: "slack-client-secret",
  SLACK_SIGNING_SECRET: "e2e-slack-signing-secret",
  SLACK_API_BASE: "http://127.0.0.1:9994",
  SLACK_AUTHORIZE_URL: "http://127.0.0.1:9994/oauth/v2/authorize",
  GITHUB_API_BASE: "http://127.0.0.1:9995",
  LINEAR_API_BASE: "http://127.0.0.1:9993",
  JIRA_API_BASE: "http://127.0.0.1:9992",
  HUBSPOT_API_BASE: "http://127.0.0.1:9991",
  CLICKUP_API_BASE: "http://127.0.0.1:9990",
  SALESFORCE_API_BASE: "http://127.0.0.1:9987",
  ASANA_API_BASE: "http://127.0.0.1:9989",
  AZURE_DEVOPS_API_BASE: "http://127.0.0.1:9988",
  INTEGRATIONS_ENABLED:
    "slack,github,linear,jira,clickup,asana,azuredevops,hubspot,salesforce",
  PUBLIC_API_URL: API,
};
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
        DIGEST_CHECK_SECONDS: "2",
        HUBSPOT_CHECK_SECONDS: "2",
        ...SECRETS,
        ...CONNECTIONS,
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
        ...CONNECTIONS,
      },
    },
    {
      command: "go run ./cmd/devslack",
      cwd: "../api",
      url: "http://127.0.0.1:9994/_dev/team",
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: "go run ./cmd/devsalesforce",
      cwd: "../api",
      url: "http://127.0.0.1:9987/_dev/ping",
      reuseExistingServer: true,
      timeout: 120_000,
      ignoreHTTPSErrors: true,
    },
    {
      command: "go run ./cmd/devclickup",
      cwd: "../api",
      url: "http://127.0.0.1:9990/_dev/ping",
      reuseExistingServer: true,
      timeout: 120_000,
      ignoreHTTPSErrors: true,
    },
    {
      command: "go run ./cmd/devasana",
      cwd: "../api",
      url: "http://127.0.0.1:9989/_dev/ping",
      reuseExistingServer: true,
      timeout: 120_000,
      ignoreHTTPSErrors: true,
    },
    {
      command: "go run ./cmd/devazure",
      cwd: "../api",
      url: "http://127.0.0.1:9988/_dev/ping",
      reuseExistingServer: true,
      timeout: 120_000,
      ignoreHTTPSErrors: true,
    },
    {
      command: "go run ./cmd/devhubspot",
      cwd: "../api",
      url: "http://127.0.0.1:9991/_dev/ping",
      reuseExistingServer: true,
      timeout: 120_000,
      ignoreHTTPSErrors: true,
    },
    {
      command: "go run ./cmd/devjira",
      cwd: "../api",
      url: "http://127.0.0.1:9992/_dev/ping",
      reuseExistingServer: true,
      timeout: 120_000,
      ignoreHTTPSErrors: true,
    },
    {
      command: "go run ./cmd/devlinear",
      cwd: "../api",
      url: "http://127.0.0.1:9993/_dev/ping",
      reuseExistingServer: true,
      timeout: 120_000,
      ignoreHTTPSErrors: true,
    },
    {
      command: "go run ./cmd/devgithub",
      cwd: "../api",
      url: "http://127.0.0.1:9995/repos/x/y",
      reuseExistingServer: true,
      timeout: 120_000,
      ignoreHTTPSErrors: true,
    },
    {
      // A Stripe stand-in whose checkout page "pays" by notifying the billing copy of the API.
      command: "go run ./cmd/devstripe",
      cwd: "../api",
      url: "http://127.0.0.1:9996/v1/customers",
      reuseExistingServer: true,
      timeout: 120_000,
      env: {
        WEBHOOK_URL: `${BILLING_API}/v1/webhooks/stripe`,
        WEBHOOK_SECRET: "whsec_e2etestsigningsecret0123456789",
      },
    },
    {
      // A second copy of the API with billing switched on (free limits apply there), and a copy of the web app for it.
      command: "go run ./cmd/server",
      cwd: "../api",
      url: `${BILLING_API}/healthz`,
      reuseExistingServer: true,
      timeout: 120_000,
      env: {
        APP_ENV: "development",
        ADDR: "127.0.0.1:18083",
        ALLOWED_ORIGINS: BILLING_WEB,
        DATABASE_URL: DB,
        SUPABASE_JWKS_URL: "http://127.0.0.1:9999/jwks.json",
        JWT_ISSUER: "http://localhost:9999",
        ...FAKE_AI,
        ...SECRETS,
        ...CONNECTIONS,
        PUBLIC_BASE_URL: BILLING_WEB,
        PUBLIC_API_URL: BILLING_API,
        STRIPE_SECRET_KEY: "sk_test_fake_key_0001",
        STRIPE_API_BASE: "http://127.0.0.1:9996",
        STRIPE_WEBHOOK_SECRET: "whsec_e2etestsigningsecret0123456789",
        PLANS_CONFIG: "../web/e2e/plans.e2e.json",
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
      command: "npm run start -- -p 13003 -H 127.0.0.1",
      url: `${BILLING_WEB}/login`,
      reuseExistingServer: true,
      timeout: 300_000,
      env: {
        API_URL: BILLING_API,
        DEV_AUTH_URL: "http://127.0.0.1:9999",
        ENABLE_DEV_AUTH: "true",
      },
    },
    {
      // A copy whose API address points nowhere, so the "something went wrong" page can be seen for real.
      command: "npm run start -- -p 13002 -H 127.0.0.1",
      url: "http://127.0.0.1:13002/login",
      reuseExistingServer: true,
      timeout: 300_000,
      env: {
        API_URL: "http://127.0.0.1:1",
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
        // company sign-in through the same stand-in
        SSO_ENABLED: "true",
        SSO_PROVIDERS: "google,azure",
        PUBLIC_WEB_URL: "http://127.0.0.1:13001",
      },
    },
  ],
});
