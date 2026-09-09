/** The workspace fixture's port; CI keeps 3000 while a developer can run beside a live instance. */
export const workspacePort = Number(process.env.DASHBOARD_BROWSER_PORT ?? 3000);
export const workspaceOrigin = `http://localhost:${String(workspacePort)}`;
/** One state file per port so two fixtures never overwrite each other's cookies. */
export const workspaceStatePath =
  process.env.DASHBOARD_BROWSER_STATE ??
  `/tmp/agentcommons-dashboard-browser-state${workspacePort === 3000 ? "" : `-${String(workspacePort)}`}.json`;
/** The SaaS fixture's port and state file follow the same per-port rule as the workspace fixture. */
export const saasPort = Number(process.env.DASHBOARD_SAAS_PORT ?? 3600);
export const saasOrigin = `http://localhost:${String(saasPort)}`;
/** The SaaS fixture's second instance, configured with a calendar URL, takes the next port. */
export const saasCalendarOrigin = `http://localhost:${String(saasPort + 1)}`;
export const saasStatePath =
  process.env.DASHBOARD_SAAS_STATE ??
  `/tmp/agentcommons-saas-browser-state${saasPort === 3600 ? "" : `-${String(saasPort)}`}.json`;
export const visualDefaults = {
  snapshotPathTemplate: "{testDir}/visual-baselines/{projectName}/{arg}{ext}",
  expect: {
    toHaveScreenshot: {
      animations: "disabled" as const,
      caret: "hide" as const,
      threshold: 0.1,
      maxDiffPixels: 0,
    },
  },
  use: {
    locale: "en-US",
    timezoneId: "UTC",
    deviceScaleFactor: 1,
    reducedMotion: "reduce" as const,
  },
};
