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
