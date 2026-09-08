# Dashboard visual baselines

Playwright compares these PNGs; saving a screenshot alone is not a comparison.
The route inventory covers public landing, guide, blog index/article, all workspace
routes, and SaaS signup, verification, onboarding, organization creation, password
setup/reset entry and Usage. Each route has light/dark baselines at 320, 390 and 1440
pixels. Scalar's separate native browser test checks rendering, operation search and
CSP rather than duplicating the third-party renderer's screenshots here.
The inventory contains 174 PNGs: 84 workspace, 66 SaaS and 24 public images,
with 58 at each width. Screenshot counts are separate from browser test counts.

Use the repository's pinned Playwright Chromium on Linux. The configs set UTC,
en-US, device scale 1, reduced motion and locally bundled fonts. Workspace/SaaS tests
start fresh real ClickHouse/PostgreSQL/API fixtures. Finish the build before starting
a fixture: the API caches public SSR documents with the build's hashed asset paths.
Explicit `REUSE_BROWSER_SERVER=1` is only for a managed fixture using that same build.
SIGTERM cleanup closes its API, workers and disposable containers.

The workspace visual organization is never mutated by functional tests. The product's
column chooser hides generated identifiers, key prefixes and receipt timestamps;
content, metric values and controls remain visible. Functional tests exercise all
columns and copy actions. Visual source timestamps use the current ISO Monday. A
visual-only clock bridge translates date filters to that real week and translates
known timestamp/date response fields back to the reference week of 2026-09-07. The
browser clock is fixed to Sunday so exclusive date filters include every weekday.
Requests reach the authenticated API and native views; counters, content, identifiers
and opaque cursors are unchanged. Timing-dependent latency values are tested
functionally. SaaS screenshots mask only the verified email and billing-period dates.
No product route responses are fabricated for screenshot comparisons.
Before axe analyzes colors, the workspace helper waits for running finite native
CSS transitions to finish. Reduced motion still creates 0.01ms theme transitions;
paused chart animations are left alone. Accessibility rules remain unchanged.

After an intentional UI change, build once and generate the relevant baselines:

```sh
pnpm --filter @agentcommons/dashboard build
pnpm --filter @agentcommons/dashboard test:browser:built --grep 'landing and guide|Markdown blog navigation' --update-snapshots
pnpm --filter @agentcommons/dashboard test:workspace:built --grep 'visual baselines' --update-snapshots
pnpm --filter @agentcommons/dashboard test:saas:built --grep 'native signup|SaaS public and billing|organization creation' --update-snapshots
```

Inspect every changed PNG, then run the same commands without `--update-snapshots`.
Commit reviewed PNGs with the change. Do not mask regressions or loosen the pixel
threshold to make a failure pass. Final pass counts and any pending comparisons are
recorded in `docs/implementation/dashboard-usability-review.md`.
