import { defineConfig, devices } from "@playwright/test";

// Walks the preview build (sample data, no backend, no sign-in). Run with `npm run test:preview`.
const URL = "http://127.0.0.1:13100";

export default defineConfig({
  testDir: "./e2e-preview",
  timeout: 60_000,
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: URL,
    trace: "retain-on-failure",
    // The first-run tour and page tips are off unless a test is about them (e2e-preview/onboarding.spec.ts),
    // because the tour covers the page while it runs.
    storageState: {
      cookies: [],
      origins: [
        {
          origin: URL,
          localStorage: [
            { name: "onb:v1:tour", value: "done" },
            { name: "onb:v1:hints", value: "off" },
          ],
        },
      ],
    },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command:
      "MOCK_UI=true npx next build && MOCK_UI=true npx next start -p 13100",
    url: `${URL}/mock`,
    timeout: 300_000,
    reuseExistingServer: false,
  },
});
