import { defineConfig, devices } from "@playwright/test";

// E2E config for the homelab dashboard.
//
// By default the suite boots the full local dev stack (`pnpm run dev:local`,
// which serves the web app on :3000 and proxies `/api` to the API server on
// :5000) and runs the browser against it. Set `E2E_BASE_URL` to point the suite
// at an already-running server instead (e.g. the Replit dev domain), in which
// case the embedded web server is skipped.
//
// Browsers: run `pnpm exec playwright install chromium` once before the first
// run (CI must do the same).
const baseURL = process.env.E2E_BASE_URL || "http://localhost:3000";
const useEmbeddedServer = !process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL,
    headless: true,
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: useEmbeddedServer
    ? {
        command: "pnpm run dev:local",
        url: "http://localhost:3000/",
        reuseExistingServer: true,
        timeout: 120_000,
      }
    : undefined,
});
