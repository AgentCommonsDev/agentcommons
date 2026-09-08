import { defineConfig } from "@playwright/test";
import { visualDefaults } from "./playwright.shared";
export default defineConfig({
  ...visualDefaults,
  testDir: "./tests",
  testMatch: ["saas.spec.ts", "users-domain.spec.ts", "organizations.spec.ts"],
  outputDir: "./test-results/saas",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  use: {
    ...visualDefaults.use,
    baseURL: "http://localhost:3600",
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
    {
      name: "mobile",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
  ],
  webServer: {
    command: "node --import tsx scripts/saas-browser-server.mjs",
    gracefulShutdown: { signal: "SIGTERM", timeout: 30_000 },
    url: "http://localhost:3600/ready",
    reuseExistingServer:
      process.env.REUSE_BROWSER_SERVER === "1" && !process.env.CI,
    timeout: 180_000,
  },
});
