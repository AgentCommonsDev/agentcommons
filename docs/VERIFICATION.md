# Verification

Run from the repository root with Node 24, pnpm 10, Docker, and the Playwright
Chromium browser installed. `pnpm exec playwright install --with-deps chromium`
installs the browser used by the deterministic tests and the agent review.

`pnpm verify` builds the artifacts, checks TypeScript and lint, runs unit and real
PostgreSQL integration tests, exercises the self-host Compose image and installer,
runs the public and authenticated browser suites, and checks schema drift,
redaction fixtures, generated OpenAPI, unused code, and requirement traceability.
The final `pnpm test:performance` runs the 150 ms hook contract by itself so other
test processes do not compete with the measurement. It requires a fresh hook build.

CI repeats verification with embeddings disabled and with the deterministic fake
provider enabled. The installer also runs under Node 20 in a clean Debian container
with bash, zsh, and fish, and in the `Installer platforms` macOS job. Local Linux
results do not establish macOS compatibility; inspect that job after pushing.

The dashboard suites use disposable databases and ports 3000–3003; stop an existing
development server before a fresh acceptance run. The browser agent uses a separate
disposable instance on ports 3100–3103 and copies the built dashboard so another
build cannot change its assets during review. All public and authenticated routes
are tested at 320, 390, and 1440 pixels in light and dark themes. The agent walk
checks representative layouts and core workflows in addition to that route matrix.

## Live provider checks

`pnpm test:browser-agent` runs the installed Claude CLI with the official Playwright
MCP server, browser tools only, and no saved agent session. A structured findings
report is written to `test-results/browser-agent/report.json`. Incomplete checks,
blocking findings, missing browser interactions, and native process failures fail
the command. The `Browser agent review` workflow runs nightly and on dashboard PRs.

`pnpm test:canary` runs the paid live E2E test. It starts a fresh real API/Postgres
instance on port 3200 and installs the generated client using the served installer.
Each driver uses a disposable Git repository, private installation directory, and
isolated native hook configuration. It never changes the workstation's normal
Claude or Codex settings. Codex uses an exclusively created temporary native profile
that is removed afterward; its existing local authentication remains available.

| Harness     | Captured version | Required live observations                                                     |
| ----------- | ---------------- | ------------------------------------------------------------------------------ |
| Claude Code | 2.1.263          | Prompt, Read call/result, Explore subagent, end, Git state                     |
| Codex       | 0.153.4          | Prompt, shell call/result, subagent, end, Git state                            |
| Gemini CLI  | 0.35.3           | Prompt, read and shell results, rewritten document, duplicate end, Git state   |
| pi          | 0.73.1           | Prompt, read result, native tree navigation, fork, resume, shutdown, Git state |

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

### Local acceptance, 2026-09-08

The final local run used the built application and disposable PostgreSQL instances.
These are observed results, separate from the requirement-citation check.

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
export checks verified both fixes. The original findings report remains intact at
`test-results/browser-agent/report.json`.

The final all-four-harness canary passed at `2026-09-08T04:27:59.826Z`. Real Claude
Code, Codex, Gemini CLI, and pi sessions appeared in the mobile dashboard. A separate
Claude agent found and read all four through nine completed MCP calls. The report
and screenshots are in `test-results/live-canary/`. A canary readiness race discovered
during acceptance now has a real-database regression: pi's earlier shutdown cannot
satisfy the check before its final parent and fork uploads commit.

Local Linux execution does not establish macOS compatibility. Check the
`Installer platforms` and two-configuration `CI` runs for the pushed commit. Hosted
paid checks need the Actions secrets listed above; local native CLI authentication
does not supply those credentials. AWS deployment remains deferred.
