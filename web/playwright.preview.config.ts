import { defineConfig, devices } from "@playwright/test";

// Walks the preview build (sample data, no backend, no sign-in). Run with `npm run test:preview`.
const URL = "http://127.0.0.1:13100";

export default defineConfig({
  testDir: "./e2e-preview",
  timeout: 60_000,
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: { baseURL: URL, trace: "retain-on-failure" },
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
