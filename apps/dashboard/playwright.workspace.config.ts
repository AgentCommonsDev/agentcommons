import { defineConfig } from "@playwright/test";
import {
  visualDefaults,
  workspaceOrigin,
  workspacePort,
  workspaceStatePath,
} from "./playwright.shared";
export default defineConfig({
  ...visualDefaults,
  testDir: "./tests",
  testMatch: [
    "app-shell.spec.ts",
    "dashboards.spec.ts",
    "sessions.spec.ts",
    "sessions-tree.spec.ts",
    "keys-sql.spec.ts",
    "admin.spec.ts",
    "redaction.spec.ts",
    "embeddings.spec.ts",
    "account.spec.ts",
    "visual.spec.ts",
  ],
  outputDir: "./test-results/workspace",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  use: {
    ...visualDefaults.use,
    baseURL: workspaceOrigin,
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
    command: "node --import tsx scripts/browser-server.mjs",
    env: {
      DASHBOARD_BROWSER_PORT: String(workspacePort),
      DASHBOARD_BROWSER_STATE: workspaceStatePath,
    },
    gracefulShutdown: { signal: "SIGTERM", timeout: 30_000 },
    url: `${workspaceOrigin}/ready`,
    reuseExistingServer:
      process.env.REUSE_BROWSER_SERVER === "1" && !process.env.CI,
    timeout: 180_000,
  },
});
