# Verification

The native ClickHouse implementation has passed local acceptance on the populated
instance and isolated real-database fixtures. Results below distinguish the current
implementation from the earlier PostgreSQL baseline. The user owns the external
Fable review; implementation agents did not invoke it. Platform CI results belong
to the pushed commit and must be checked separately from local Linux results.

Run from the repository root with Node 24, pnpm 10, Docker, and the Playwright
Chromium browser installed. `pnpm exec playwright install --with-deps chromium`
installs the browser used by the deterministic tests and the agent review.

`pnpm verify` builds the artifacts, checks TypeScript and lint, runs unit and real
PostgreSQL and ClickHouse integration tests, exercises the self-host Compose image
and installer, runs the public and authenticated browser suites, and checks schema drift,
redaction fixtures, generated OpenAPI, unused code, and requirement traceability.
The final `pnpm test:performance` runs the 150 ms hook contract by itself so other
test processes do not compete with the measurement. It requires a fresh hook build.

Integration and container E2E files run sequentially. Each owns real database or
container processes, and the latency checks need CPU time for both the test client
and server. Running four fixtures on a two-core runner caused validation and latency
failures. CI gives the typed ESLint process a 4 GB heap; the measured peak was
2.85 GiB. The hook's 150 ms limit and the native reader's five-second callback and
256 MiB query budget remain enforced. Native search uses the seeded p95 target of
less than one second recorded in ADR0047; the earlier PostgreSQL 150 ms search
target is not a passing claim for ClickHouse.

CI repeats verification with embeddings disabled and with the deterministic fake
provider enabled. The installer also runs under Node 20 in a clean Debian container
with bash, zsh, and fish, and in the `Installer platforms` macOS job. Local Linux
results do not establish macOS compatibility; inspect that job after pushing.

The dashboard suites use disposable databases and ports 3000–3003; stop an existing
development server before a fresh acceptance run. The browser agent uses a separate
disposable instance on ports 3100–3103 and copies the built dashboard so another
build cannot change its assets during review. The functional route matrix covers
public and authenticated routes at 320, 390, and 1440 pixels in light and dark themes. The current matrix passed as recorded below; configured coverage alone does not establish a passing run. The agent walk
checks representative layouts and core workflows in addition to that route matrix.

## Live provider checks

`pnpm test:browser-agent` runs the installed Claude CLI with the official Playwright
MCP server, browser tools only, and no saved agent session. A structured findings
report is written to `test-results/browser-agent/report.json`. Incomplete checks,
blocking findings, missing browser interactions, and native process failures fail
the command. The `Browser agent review` workflow runs nightly and on dashboard PRs.

`pnpm test:canary` runs the paid live E2E test. It starts a fresh real API/PostgreSQL/ClickHouse
instance on port 3200 and installs the generated client using the served installer.
Each driver uses a disposable Git repository, private installation directory, and
isolated native hook configuration. It never changes the workstation's normal
Claude or Codex settings. Codex uses an exclusively created temporary native profile
that is removed afterward; its existing local authentication remains available.

| Harness     | Captured version | Required live observations                                                              |
| ----------- | ---------------- | --------------------------------------------------------------------------------------- |
| Claude Code | 2.1.263          | Prompt, Read call/result, Explore subagent, end, Git state                              |
| Codex       | 0.153.4          | Prompt, shell call/result, subagent, end, Git state                                     |
| Gemini CLI  | 0.35.3           | Prompt, generalist delegation call/result, rewritten document, duplicate end, Git state |
| pi          | 0.73.1           | Prompt, read result, native tree navigation, fork, resume, shutdown, Git state          |

Every session must be complete, searchable through REST and MCP, readable through
both transports, and visible in the mobile dashboard. A separate native Claude
agent receives only the four search markers, finds the session IDs through MCP,
and calls `get` for each one. Its completed tool calls and returned identities are
checked against the ingested sessions. An SDK client alone does not satisfy this
agent check. The report and screenshots are written to `test-results/live-canary/`.
Harness versions are checked before use; capture and review a changed contract
before changing a pinned version.

Local canaries use the CLI's existing Claude/Codex authentication and a
`GEMINI_API_KEY` for Gemini and pi. The `Live harness canary` workflow runs nightly
and on adapter PRs. Hosted jobs require repository Actions secrets named
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and `GEMINI_API_KEY`; the browser review needs
only `ANTHROPIC_API_KEY`. Missing credentials fail the live job rather than count
as a passing test. Provider credentials are not given to fork PR jobs. Review a
fork's changes before running a trusted workflow for them.

Raw native logs and fixture credentials stay in private temporary directories.
Workflows upload only redacted reports and the canary's session screenshots. No
provider key is written into repository files or hook commands.

## Completion evidence

`node scripts/spec-check.mjs --report` maps every requirement to its test citations.
Zero uncovered requirements is necessary, but does not prove those tests passed.
Keep the test output, browser findings, platform results, and all-four-harness live
report together when assessing spec §16.1 item 8. AWS deployment is a separate,
deferred step; `DEPLOYMENTS_ENABLED` remains unset until the operator enables it.

### Current ClickHouse acceptance, 2026-09-08

The native implementation uses PostgreSQL for identity and compact control state;
ClickHouse holds the trace corpus and vectors. These are observed results from the
current source, not the older PostgreSQL baseline below.

| Gate                                                              | Observed result                                                                                                                                       |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build, strict TypeScript, ESLint, Prettier, knip                  | Passed on frozen source, including the final SQL schema-focus and native completion-close fixes                                                       |
| Unit tests                                                        | 253 passed across 49 files                                                                                                                            |
| Schema validation and drift, fixture redaction, generated OpenAPI | Passed; 44 captured fixtures checked; generated contract reviewed                                                                                     |
| Requirement citations                                             | 173 covered, zero uncovered; all cited suites have passing evidence, including the separately invoked live canary                                     |
| Native security                                                   | 18/18 passed in 45.57 s on real PostgreSQL and ClickHouse, including two final schema-discovery/uncapped-search regressions                           |
| HTTP transport and lifecycle                                      | 17/17 passed in 74.49 s across two files                                                                                                              |
| Full embeddings-off/on integration matrices                       | 300/300 passed with fake embeddings on; off passed 299, then the remaining native-mail canary passed in isolation after a parallel-run port collision |
| Compose application and installer                                 | Passed with embeddings off (266.67 s) and fake embeddings on (256.30 s); final frozen-source image passed again in 234.45 s                           |
| Other artifact E2E                                                | Five passed; paid canary is a separate explicit run                                                                                                   |
| Public browser suite                                              | 27/27 passed, including screenshot comparisons                                                                                                        |
| Fresh SaaS browser suite                                          | 21/21 passed, including native SMTP and local provider protocol fixtures                                                                              |
| Complete authenticated workspace browser matrix                   | 123 unique cases passed: 117 interactions across documented runs and six final visual comparisons; six expanded SQL cases also passed                 |
| Live native SaaS canary                                           | All four harnesses passed; nine completed search/get calls by a separate native agent                                                                 |
| Captured search adoption probe                                    | Two searches, one repeat and one subsequent native Grep; native Usage increased by exactly 26 captured records                                        |
| Implementation-agent populated-instance walkthrough               | Owner/member access, signed-in landing, real-data profile save/reload/delete, arbitrary tool filter and actual child-message expansion passed         |
| Isolated hook timing                                              | 2/2 passed in 9.14 s in isolation after disposable-store cleanup; unchanged 150 ms bound and 5,000 pending intents                                    |
| Pushed CI and macOS installer                                     | Inspect the CI and Installer platforms workflow runs for the pushed commit; local Linux is not macOS evidence                                         |

Five- and fifteen-reader native bursts and five-/fifteen-request HTTP detail bursts
passed on populated fixtures without increasing deadlines or connection pools. The
purge regression removes payloads and retains only native organization/session IDs.
Warmed reads fail after PostgreSQL control access is revoked, and hidden-parent
SELECT, predicate, ordering and join attempts are rejected. Historical source clocks
now agree with the tree cursor ordering, including delayed uploads and resumes.
The focused outputs are `/tmp/agentcommons-native-security-18-final.log` and
`/tmp/agentcommons-native-final-http-tree.log`; local paths are not durable CI artifacts.

The live SaaS canary passed at `2026-09-08T12:42:31.311Z` in
`test-results/live-canary/report.json`. Claude and Codex children expose their own
captured tool results through REST, MCP and the expanded mobile tree. pi's native
fork and resume are preserved; Gemini's inline generalist delegation is not invented
as a separate child session. The separate native MCP agent found and read all four
parents. Initial usage was 120 real source records. The later captured Claude
search/search/get/Grep probe raised it to 146, matching both source-admission and
usage ledgers, and made Home show one of eight sessions using search (12.5%). The
real `get` created one same-user reuse edge inside the captured active window: reuse
was 1/8, while cross-user reuse correctly stayed zero. Its
separate report is `test-results/native-adoption/report.json`.

The implementation-agent walkthrough used the retained native SaaS store and the
existing local owner/member accounts, with no mocked application responses. It
created and restored a JSON chart over the four real harnesses, filtered the actual
Gemini session by its `generalist` tool name, expanded Claude/Codex/pi child messages
at 320 pixels, checked member access at 390 pixels and kept the signed-in landing
visible with a Dashboard link. The full deterministic matrix also passed: 171 unique browser cases and 174 reviewed screenshot baselines across public, workspace and SaaS suites.
The user preview on port 5173 now runs this native SaaS store. The final 320-pixel
light/dark checks passed native SQL with both Ctrl+Enter and touch Run, closed
completion suggestions, and found no overflow, serious axe findings or page errors.
A fresh post-switch
owner login, organization selection, landing Dashboard link, six main routes and
native SQL query passed without browser errors. All 117 workspace interaction cases and isolated hook timing passed. The final six
workspace visual comparisons passed in 3.6 minutes against all 84 reviewed images,
without changing screenshot thresholds or excluding accessibility rules. The test
waits for the current native CSS transitions to settle before axe reads colors; it
does not change application styles. See the [browser review](implementation/dashboard-usability-review.md)
for the exact run inventory and test-readiness fixes.

Google's real consent flow requires the operator's allowed callback/test-user setup.
Local Stripe SDK/webhook and Cal.com protocol fixtures establish application behavior,
not live payments or a configured sales calendar. No Stripe charges or cloud deployment
were performed. Fable was not invoked.

### Baseline acceptance before SaaS and structured filters, 2026-09-08

The baseline local run used the built application and disposable PostgreSQL instances.
These observed results predate the later SaaS, verified-domain enrollment, adoption and
structured-filter changes. They do not establish acceptance of those additions.

| Gate                                                              | Result                                                                                                               |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Build, strict TypeScript, ESLint, Prettier, knip                  | Passed                                                                                                               |
| Unit tests                                                        | 220 passed across 39 files                                                                                           |
| Full integration matrix                                           | 168 passed with embeddings off; 168 passed with embeddings on and the fake provider                                  |
| Final native-completion regression                                | Passed separately in both embeddings configurations                                                                  |
| Container, installer, shim and MCP E2E                            | 6 passed in each configuration; the paid canary is invoked separately                                                |
| Public browser suite                                              | 15 passed                                                                                                            |
| Workspace browser suite                                           | 85 passed; two extra 320px screenshot cases intentionally skip because required workspace baselines cover 390/1440px |
| Final CSV browser regressions                                     | 18 passed across 320/390/1440px                                                                                      |
| Screenshot comparisons                                            | 64 reviewed PNG baselines passed: 52 workspace and 12 public                                                         |
| Schema validation and drift, fixture redaction, generated OpenAPI | Passed                                                                                                               |
| Requirement traceability                                          | 151 requirements covered, zero uncovered                                                                             |
| Isolated hook timing                                              | Both tests passed with the unchanged 150ms bound, including 5,000 queued intents                                     |

All 320px functional, overflow, keyboard, and accessibility cases ran. The
[baseline notes](../apps/dashboard/tests/visual-baselines/README.md) document the
deterministic visual setup and review process.

The fresh browser-agent review completed 148 browser calls and all eight required
flows without console or network failures. Its two nonblocking findings were fixed:
Home now explains the selected activity section, and Status identifies the applied
repository scope. The subsequent complete browser matrix and focused absent-repository
export checks verified both fixes. The run used
`test-results/browser-agent/report.json`; later runs may replace that conventional
artifact path. Do not treat its current contents as the dated baseline
without checking the report timestamp.

The baseline all-four-harness canary passed at `2026-09-08T04:27:59.826Z`. Real Claude
Code, Codex, Gemini CLI, and pi sessions appeared in the mobile dashboard. A separate
Claude agent found and read all four through nine completed MCP calls. The report
and screenshots used `test-results/live-canary/`; current native runs replace those
paths. A canary readiness race discovered
during acceptance now has a real-database regression: pi's earlier shutdown cannot
satisfy the check before its final parent and fork uploads commit.

Local Linux execution does not establish macOS compatibility. Check the
`Installer platforms` and two-configuration `CI` runs for the pushed commit. Hosted
paid checks need the Actions secrets listed above; local native CLI authentication
does not supply those credentials. AWS deployment remains deferred.
