import { defineConfig } from "@playwright/test";
import { visualDefaults } from "./playwright.shared";
export default defineConfig({
  ...visualDefaults,
  testDir: "./tests",
  testMatch: "landing.spec.ts",
  outputDir: "./test-results/public",
  fullyParallel: true,
  workers: 2,
  use: {
    ...visualDefaults.use,
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "small-mobile",
      use: {
        viewport: { width: 320, height: 740 },
        isMobile: true,
        hasTouch: true,
      },
    },
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    {
      name: "mobile",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  // The preview proxies /auth, /api and /mcp to AGENTCOMMONS_API_ORIGIN; the stub answers the
  // read-only calls the public pages make on load, so the suite needs no running instance.
  webServer: [
    {
      command: "node tests/public-api-stub.mjs 4174",
      url: "http://127.0.0.1:4174/auth/get-session",
      reuseExistingServer:
        process.env.REUSE_BROWSER_SERVER === "1" && !process.env.CI,
      timeout: 30_000,
    },
    {
      command: "pnpm preview --port 4173 --strictPort",
      url: "http://127.0.0.1:4173",
      env: { AGENTCOMMONS_API_ORIGIN: "http://127.0.0.1:4174" },
      reuseExistingServer:
        process.env.REUSE_BROWSER_SERVER === "1" && !process.env.CI,
      timeout: 120_000,
    },
  ],
});
