# Dashboard visual baselines

Playwright compares these PNGs; saving a screenshot alone is not a comparison.
The route inventory covers the public landing, guide, blog index and article; the
application under `/app` (Home, the built-in Team overview dashboard, People, Settings)
and sign-in; and the SaaS landing, docs, signup, sign-in, verification notice,
verify-email and forgot-password requests, onboarding, password setup, Billing and the
new-organization page. Each route has light and dark baselines at 320, 390 and 1440
pixels: 30 workspace, 66 SaaS and 24 public images, 40 at each width, 120 in total.
Sessions, session detail, SQL and Keys baselines are added with their suites. Scalar's
separate native browser test checks the embedded API reference rather than duplicating
the third-party renderer's screenshots here. Screenshot counts are separate from browser
test counts.

Use the repository's pinned Playwright Chromium on Linux. The configs set UTC, en-US,
device scale 1, reduced motion and locally bundled fonts. Workspace and SaaS tests start
fresh real ClickHouse, PostgreSQL and API fixtures (`scripts/browser-server.mjs` on
`DASHBOARD_BROWSER_PORT`, default 3000, and `scripts/saas-browser-server.mjs` on 3600).
Finish the build before starting a fixture: the API caches public SSR documents with the
build's hashed asset paths. Explicit `REUSE_BROWSER_SERVER=1` is only for a managed
fixture using that same build. SIGTERM cleanup closes the API, workers and disposable
containers.

The workspace visual organization (`browser-visual`) is never mutated by functional
tests. Its three sessions carry source timestamps on the current ISO Monday. A
visual-only clock bridge (`tests/visual-time.ts`) translates date filters to that real
week and translates known timestamp fields and ISO date cells in SQL result rows back to
the reference week of 2026-09-07; the browser clock is fixed to Sunday of that week.
Requests reach the authenticated API and native views; counters, content, identifiers
and cursors are unchanged. The only masks are the "Rendered … ago" footer of a dashboard,
the People page's Last seen times (the run's own requests, made on the real weekday) and
the generated organization id on Settings. Before axe analyzes colors, the helper
waits for running finite CSS transitions to finish. No product route responses are
fabricated for screenshot comparisons.

After an intentional UI change, build once and generate the relevant baselines:

```sh
pnpm --filter @agentcommons/dashboard build
pnpm --filter @agentcommons/dashboard test:browser:built --grep 'landing and guide|Markdown blog navigation' --update-snapshots
pnpm --filter @agentcommons/dashboard test:workspace:built --grep 'visual baselines' --update-snapshots
pnpm --filter @agentcommons/dashboard test:saas:built --grep 'native signup|SaaS public|organization creation' --update-snapshots
```

Inspect every changed PNG, then run the same commands without `--update-snapshots`.
Commit reviewed PNGs with the change. Do not mask regressions or loosen the pixel
threshold to make a failure pass.
