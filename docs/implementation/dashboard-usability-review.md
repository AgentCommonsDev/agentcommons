# Dashboard usability revision, 2026-09-08

This is an in-progress review following the user's rejection of horizontal table
bleed, dense Home/Status metrics, and overlapping SQL/schema controls. It does not
replace the final browser matrix or native canaries.

## Controls exercised against the real local API

`apps/dashboard/tests/usability.spec.ts` uses native authenticated cookies and real
PostgreSQL/API responses. Its first six cases passed at 320, 390, and 1440 in both
themes (44.9 seconds); the three Installation cases passed in 24.4 seconds.
Mobile cases use actual touch taps; desktop uses clicks.

| Area         | Concrete actions and assertions                                                                                                                                             |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entry        | Select actual organization, visit `/`, keep landing visible with a Dashboard CTA                                                                                            |
| Tables       | Open Columns, close with Escape, open full record, inspect fields omitted from summary, close with button                                                                   |
| CSV          | Download actual filtered session export; verify omitted summary columns and rows remain in CSV                                                                              |
| SQL schema   | Copy schema, compare parsed clipboard exactly to authorized `/api/v1/schema`; open browser, select functions                                                                |
| SQL query    | Execute actual query; inspect result; assert internal table and document fit viewport; axe serious/critical zero                                                            |
| Installation | Create actual sessions ingest/read key, copy served command, verify permissions, send native fixture through actual ingest using new key, observe202 and exact arrival link |

The Installation browser test does not pretend to launch a native coding harness.
The separately maintained live canaries exercise the served installer and actual
Claude Code, Codex, Gemini CLI, and pi sessions.

First-pass screenshots of Home, Sessions, SQL, Status, Keys and Installation at320
and1440 were inspected from `/tmp/agentcommons-usability`. Useful default summary
columns, compact USD display, and a visible Copy full schema label were corrected
after that inspection. The latest build includes those corrections and the new
organization embedding control; focused regression runs are still required on it.

## Superseded expectations being updated

The user explicitly superseded horizontal-scroll table expectations and duplicate
Home/Status metric panels. Tables now expose a small selectable summary plus full
record details; all table columns remain in CSV. Status presents health/queues/costs;
Home owns adoption, reuse and member impact. Usage/Outcomes metric APIs remain tested.
Existing screenshot baselines must be refreshed only after functional review settles.
No baseline was changed during this usability revision.

## Dynamic dashboard library prototype

Perspective5.3.1 was installed only under `/tmp/agentcommons-perspective-probe`.
Its native aggregate editing and two-panel JSON save/reload worked at 320/390/1440.
However the236px settings sidebar leaves84px for plots at320, native controls are
small, and split panels do not stack on mobile. The tested built bundle also needs
WASM and blob-script/worker CSP permissions. No numeric KPI plugin ships in its chart
catalog. The recommendation is to reject it as the default mobile authoring UI unless
substantial custom adaptation is accepted. No production dependency or editor was added.

Official references: [v5 release](https://github.com/perspective-dev/perspective/discussions/3205),
[Apache2 license](https://github.com/perspective-dev/perspective/blob/master/LICENSE.md).
Prototype source, exact save/restore report, CSP probes and inspected screenshots are
in the temporary directory. Its rows are explicitly synthetic; authorized SQL-result
integration was not attempted after the mobile selection criterion failed.

## SQL, profiles and blog follow-up (pre-ClickHouse baseline)

The fresh native PostgreSQL fixture passed12 responsive SQL/profile cases in1.6m:
320/390/1440, light/dark, actual SQL/schema requests, parser errors, table/column/
function suggestions, touch acceptance, Ctrl+Enter, Tab escape, canonical clipboard,
CSV, profile create/edit/duplicate/reload/delete, number/bar/line rendering, strict CSP
without unsafe-eval and serious/critical axe findings absent. Another6cases passed
in33.2s for native JSONForms add/reorder/delete-widget controls. This is explicitly
pre-ClickHouse evidence; the final storage runtime must rerun these flows.

The parser now imports the shared native ClickHouse module. Schema completion stays
data-driven. Profiles use JSONForms NoValidation to avoid Ajv runtime code generation;
shared Zod validates the actual declaration on save and on the server. Recharts uses
one unit per widget. SQL result bounds/copy/CSV live in one shared SqlResult component.

Blog source/catalog/prerender/metadata/discovery and customer404 tests passed6/6.
Initial blog phone tests caught the public header's long CTA causing overflow. The
header now uses a concise account label, icon branding below480px and44px controls.
Final browser checks on that correction and the clearer JSONForms input borders are
pending. No screenshot baseline was relaxed.

Remaining independent walkthroughs: new organization creation and issuer labels on
keys; native ClickHouse diagnostics and complete new-storage flows; records/add-on
billing and signup/verification; final blog no-JS/hydration; intentional baselines;
then the user-owned independent review. The user explicitly prohibited invoking
Fable. The historical pending items above are superseded by the native acceptance
evidence below; they remain here to distinguish pre-ClickHouse prototype results.

## Native ClickHouse acceptance, final pass

The final runtime uses ClickHouse traces with PostgreSQL control data. Public browser
comparisons passed 27/27; the fresh SaaS browser suite passed 21/21 with real SMTP,
native auth and the official Stripe SDK against its local provider fixture. No live
Stripe charge or calendar booking was made. The populated user preview on port5173
uses the retained native stores and unchanged verified owner/member credentials.

The native canary passed all four installed coding harnesses. Claude and Codex child
sessions and the pi fork were independently read through REST, MCP, search and actual
mobile Tree taps, including their own tool-result content. Gemini's captured
`generalist` delegation remains inline because its native transcript supplied no
separate child identity. A second real Claude session used AgentCommons search twice
and Grep afterward. Home reports eight captured sessions, one searched session, two
search calls, one repeat and one subsequent other search. Usage reports 146 actual
accepted records. No transcript replay, metric inserts or billing backfill were used.

The root review independently exercised the populated instance: chart create/save/
reload/delete from native SQL across four harnesses; actual Gemini tool filtering;
Claude/Codex/pi child expansion at 320px; member sign-in and organization selection at
390px; shared sessions and blocked admin pages; signed-in landing and main routes.
Private review reports are outside the repository; the sanitized native reports are
`test-results/live-canary/report.json` and `test-results/native-adoption/report.json`.

The workspace interaction inventory now has 117 unique passing cases across four
runs (52 + 22 + 12 + 31). The last 31 passed in 6.2 minutes. This is an aggregate of the
recorded runs, not a claim of one coherent 117-case execution. The final pass found
and fixed a keyboard-inaccessible scrollable schema region and suggestions remaining
after Run. Six focused responsive SQL cases passed in 1.1 minutes at 320/390/1440 in
both themes, exercising native keyboard execution and actual touch/click Run.
A separate contrast failure was traced to Playwright `.fill()` injecting inline
formatting into CodeMirror; the query helper now types real keystrokes. Product CSS
and accessibility rules were not weakened.

The exact 117-case inventory is preserved privately in
`/tmp/agentcommons-workspace-117-evidence.json`, with each original log and test title.
The populated preview's final 320 light/dark SQL/landing checks passed independently:
`/tmp/agentcommons-saas-demo/sql-completion-5173.json`. Both execution controls close
suggestions, real results load, and overflow, serious axe findings and page errors
are absent. The same checks passed on staged 55173 before the live API restart.

The router has 24 templates. Their functional coverage is complete. The final visual
pass adds the missing blog index/article, Installation, organization creation and
320-pixel workspace/SaaS baselines. The six blog comparisons passed in 11.7 seconds;
the eight focused SaaS comparisons passed in 1.2 minutes. All six workspace
comparisons passed in 3.6 minutes. Scalar's separate native browser test covers rendering, operation
search and CSP. No screenshot threshold or accessibility exclusion was added.

The final password-setup contrast probe caught a transient theme transition during
hydration. Under reduced motion, the browser still creates 0.01ms native CSS
transitions. Six repeated probes had correct settled colors and no axe violations.
The test now waits, within its existing assertion deadline, for current running
finite CSS transitions to finish before axe reads colors. It does not cancel
animations, change styles, wait on paused chart animations or retry accessibility
analysis. No production theme change was needed.

Final browser logs (private local evidence):

| Coverage                                             | Evidence                                                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 117 unique workspace interaction cases               | `/tmp/agentcommons-workspace-117-evidence.json` maps the four runs to unique project/test titles             |
| Six focused SQL keyboard/touch cases                 | `/tmp/agentcommons-native-sql-completion-six.log`                                                            |
| 27 public cases and six final blog comparisons       | `/tmp/agentcommons-native-public-comparison.log`, `/tmp/agentcommons-native-blog-comparison.log`             |
| 21 SaaS cases and eight final responsive comparisons | `/tmp/agentcommons-native-saas-fresh-comparison.log`, `/tmp/agentcommons-final-saas-baseline-comparison.log` |
| Final six workspace visual comparisons               | `/tmp/agentcommons-final-workspace-six-comparison.log`                                                       |
| Final populated-instance SQL and landing checks      | `/tmp/agentcommons-saas-demo/sql-completion-5173.json`                                                       |

The final inventory is 171 unique browser cases: 27 public, 123 workspace (117
interaction cases plus six visual cases), and 21 SaaS. Focused reruns are evidence
for the same cases, not additional unique tests. All 174 reviewed PNGs were compared:
84 workspace, 66 SaaS and 24 public, with 58 images at each width. The route matrix
covers all 24 templates at 320/390/1440 in light and dark themes.

Final scoped dashboard TypeScript, ESLint and formatting checks passed after the
test-readiness change. Production assets did not change after the final native
preview build. The populated local instance remains on the tested ClickHouse and
PostgreSQL stores with its existing verified accounts and actual harness captures.

The disposable workspace fixture exited cleanly on SIGTERM. Its PostgreSQL and
ClickHouse containers were removed; the SaaS fixture had already closed cleanly.
The retained native canary controller, user preview on 5173, stage on 55173 and their
PostgreSQL/ClickHouse/Mailpit stores were left running.
