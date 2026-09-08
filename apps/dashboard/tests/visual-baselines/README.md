# Dashboard visual baselines

These PNGs are compared by Playwright, not just saved as test artifacts. Public pages cover 320, 390, and 1440 pixels in both themes. Every authenticated route, login, and password setup covers 390 and 1440 pixels in both themes; 320 retains the complete functional, overflow, keyboard, and accessibility matrix.

Use the repository's pinned Playwright Chromium on Linux. The configs set UTC, en-US, device scale 1, reduced motion, and locally bundled fonts. Workspace tests start a fresh real PostgreSQL/API fixture by default. Their separate visual organization is never mutated by functional tests. The test uses the product's column chooser to hide only generated identifiers, key prefixes, and runtime timestamps. This is a supported user view, with no masks or CSS overrides; random native identifier widths cannot shift adjacent columns. The functional matrix exercises all columns and copy actions. Session content, metric values, controls, and labels remain visible. The visual fixture dates its three transcripts at the current ISO Monday. A visual-only Playwright clock bridge translates date filters into that real week and translates timestamp/date response fields back into the fixed week of 2026-09-07. Requests still reach the authenticated API and SQL views; counters, metric values, content, identifiers, and opaque cursors are unchanged. This keeps Home's SQL `now()` and Status date filters aligned across week boundaries. The browser clock is fixed to Sunday of that reference week, so the exclusive date filter includes real receipts from every weekday. The default Status metric is coverage, whose seeded installation/member counts are stable; duration and latency values are tested functionally. Every functional test uses the real API without interception.

To review an intentional UI change:

```sh
pnpm --filter @agentcommons/dashboard build
pnpm --filter @agentcommons/dashboard test:browser:built --grep 'landing and guide' --update-snapshots
pnpm --filter @agentcommons/dashboard test:workspace:built --grep 'visual baselines' --update-snapshots
```

Inspect every changed PNG, then run the same comparison commands without `--update-snapshots` against fresh servers. Commit the reviewed PNGs with the UI change. A generated image alone does not demonstrate a passing comparison. Do not mask regressions or loosen the pixel threshold to make a failure pass.
