# User request acceptance ledger

This ledger preserves the full implementation scope and subsequent product feedback.
It records the final local evidence and external configuration boundaries. Requirement
citations are in REQUIREMENTS.md; observed results are in VERIFICATION.md. The latest user instruction freezes feature scope: finish ClickHouse, fix introduced
regressions, and validate the populated instance dynamically. Do not invoke Fable;
the user owns that handoff. Earlier requests below remain an inventory, not permission
to add another dashboard framework or expand the product during this final pass.

| Request                                                                            | Owner                            | Verification or boundary                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SPEC §17 in order, §16.1(8), all requirements covered                              | Root                             | Native integration: 300 passing tests per embedding mode (one off-mode port-collision rerun); 171 browser cases and 173/173 requirement citations verified; pushed platform CI is a separate check             |
| ClickHouse traces/analytics; PostgreSQL auth/org/billing/control; no legacy corpus | Database + infrastructure + root | Native security, source-clock, purge, hidden-parent and five/15 concurrency regressions pass; full native integrations pass in both modes                                                                      |
| Native Gemini/pi capture before adapter; all four harnesses                        | Database + root                  | Captured contracts include Gemini generalist delegation; fresh native SaaS canary passed 2026-09-08T12:42:31.311Z with four harnesses and nine agent MCP calls                                                 |
| Actual subagent hierarchy, expandable messages/tool results, source links          | Root                             | Tree/header implemented; native hidden-parent, source-clock cursor and bounded paging tests pass; fresh canary checks child content; 117 workspace interaction cases and all six final visual comparisons pass |
| Visible clickable Git repository/branch/start/end SHA                              | Root                             | Safe repository, branch and start/end SHA links verified in native canaries and browser interactions                                                                                                           |
| Search UI and MCP same general filters, arbitrary observed tools/JSON params       | Root + UI                        | Shared structured conditions implemented; native REST/MCP parity and edge cases pass; 117 workspace interaction cases and all six final visual comparisons pass                                                |
| SQL syntax highlighting, diagnostics, completion, copy canonical schema            | UI                               | Native CodeMirror highlighting/completion/diagnostics and schema copy implemented; 117 workspace interaction cases and all six final visual comparisons pass                                                   |
| Scalar from generated Zod OpenAPI                                                  | Infrastructure                   | Generated Zod OpenAPI and Scalar HTTP/browser checks pass; generated contract reviewed                                                                                                                         |
| Home default adoption/reuse KPIs and persistent dynamic profiles                   | Root + UI                        | JSON Forms/Recharts profiles persist in PostgreSQL through REST/MCP; native create/edit/duplicate/save/reload/delete and real four-harness chart checks pass                                                   |
| Sessions using search, repeat searches, subsequent other searches                  | Infrastructure + UI              | Real captured Claude search/search/get/Grep yields two searches, one repeat and one subsequent other search; Home and Usage agree with native source records                                                   |
| Distinct Home/Status purpose, no duplicate metric panels                           | UI                               | Selected Home profile and distinct Status operational controls pass the current browser suite                                                                                                                  |
| Dedicated Installation with key, one-liner, actual arrival                         | UI                               | Actual served installer connects all four native harnesses; Installation/key/command/arrival browser flows pass                                                                                                |
| Every control, table, disclosure, dropdown, form, errors, empty states             | All                              | 24 route templates mapped; all 117 workspace interaction cases and all six final visual comparisons pass                                                                                                       |
| Mobile landing and app, no bleeding tables/overlap                                 | UI                               | All 117 workspace interaction cases and 84 workspace screenshot comparisons pass; actual 320px child content and 390px member walkthrough pass                                                                 |
| Native organizations, memberships, email access, roles, tenant isolation           | Database                         | Native integration and real Users/domain/SaaS organization browser cases pass                                                                                                                                  |
| Multi-org dropdown and explicit SaaS Create organization                           | Database + UI                    | Native create/select/switch verified in SaaS browser suite; current populated preview owner/member organization selection passes                                                                               |
| Organization key owners show email/name; IDs stay internal/details                 | Database + UI                    | Stable user_id retained in API; current UI owner/details covered by organization tests                                                                                                                         |
| Google domain whitelist for goodhartlabs.com; native verified SSO                  | Database                         | Native OAuth/DNS tests pass; real Google preview callback/test-user config external                                                                                                                            |
| Admin organization embeddings opt-in                                               | Infrastructure                   | Native opt-in, SaaS entitlement and revocation tests pass; 117 workspace interaction cases and all six final visual comparisons pass                                                                           |
| Link installed secretlint presets/rules; redaction/custom policy copy              | Root + UI                        | Clickable preset/rule sources and redaction/custom-policy copy reviewed; native redaction/rescan tests pass                                                                                                    |
| Generated minimalist logo/favicon/main site and README identity rek7               | UI                               | Generated logo/favicon assets present; public and SaaS visual comparisons pass; README identity is rek7                                                                                                        |
| Concise README value: coordination, decisions, versioned instructions/skills       | UI                               | Concise README reviewed with no-ai-slop; instructions and source links checked                                                                                                                                 |
| Shopify River link, chat workflow/vendor limitations described accurately          | UI                               | Linked and checked against the live Shopify, Claude Tag and OpenTag source pages                                                                                                                               |
| Current observability/governance; brief future detection/admin tool controls       | UI                               | Copy revised; do not claim future detection or runtime blocking exists                                                                                                                                         |
| Public landing remains visible when signed in, with Dashboard CTA                  | UI                               | Public/SaaS tests and actual owner/member preview walks keep landing visible with Dashboard CTA                                                                                                                |
| Markdown blog, dynamic SEO/sitemap/robots/llms.txt/llms-full.txt                   | UI                               | Markdown catalog, SSR metadata, generated discovery and customer noindex behavior pass unit/HTTP and 27 public browser tests                                                                                   |
| SaaS free signup, native verification/reset, welcome delivery                      | Database + UI                    | Fresh SaaS browser suite 21/21 passes, including native verification/reset/welcome delivery through real SMTP                                                                                                  |
| Pro base subscription plus configurable per-1000 ingestion consumption             | Infrastructure + UI              | Native Stripe SDK/webhook fixtures, actual quota/admission/usage/period/meter tests and SaaS browser flows pass; no live charges                                                                               |
| SaaS embeddings $50/month plus configurable per-1000 usage                         | Infrastructure + UI              | Base add-on plus configurable usage and native Stripe entitlement tests pass; no live Stripe charges                                                                                                           |
| No additional SaaS billing for customer/self-hosted instances                      | Infrastructure                   | Customer/self-host billing bypass passes native integration and container checks                                                                                                                               |
| Enterprise demo, white-glove on-prem/single-tenant, identity integration           | UI + Infrastructure              | Configured Cal.com embed and upgrade/demo routes pass local provider/browser fixtures; real calendar remains operator configuration                                                                            |
| SOC2 mark                                                                          | UI                               | Omitted unless proof supplied; do not imply certification                                                                                                                                                      |
| AWS via Tailscale; tenant domain and Google setup instructions                     | Root                             | Access checked; cloud deployment deferred; local/private setup doc maintained                                                                                                                                  |
| Persistent /tmp SaaS demo, real harness input, test account credentials            | Root                             | Current native SaaS serves port 5173 with existing verified owner/member credentials, eight real sessions and 146 captured records; post-switch browser login/landing/main routes/SQL pass                     |
| Fable 5.1 actual browser simplification review                                     | Root                             | USER-OWNED; explicitly do not invoke Fable                                                                                                                                                                     |
| Finish local validation, commit/push with hooks, inspect CI                        | Root                             | Local gates pass; commit/push runs the required hooks; inspect CI and Installer platforms for the pushed commit                                                                                                |

Rates not specified by the user remain deployment configuration, with clearly labeled
local test values. Real Stripe activation requires actual account configuration.
Google consent testing requires the user to register the preview callback and test users.

## Browser acceptance inventory

This inventory applies to the implementation team’s own browser tests and the user’s
subsequent independent review. It does not authorize invoking Fable. Read SPEC §10
and the browser fixtures before the walkthrough. Use the isolated, real API/ClickHouse/PostgreSQL fixture;
never mock product routes to make a flow pass. Test both member and owner/admin flows.

Walk through public landing/blog/docs, anonymous signup/verify/sign-in/reset, signed-in
landing with Dashboard CTA, organization selection/create/switch, Installation through arriving
session, Home default/custom profiles create/edit/duplicate/JSON/save/reload/delete,
search every filter and pagination/CSV, session tree through actual child messages and
tool results, Git/deep links, raw transcript/live state, SQL typing/completion/lint/run/
error/schema copy/CSV, keys create/copy/revoke/owner labels, Users add-email/role/suspend/
domain DNS proof, redaction source links/test/rescan, moderation, audit, Status embedding
toggle/health, Usage subscription/add-on/consumption/demo, logout and protected routes.

Repeat representative controls at 320, 390, and 1440 pixels in light/dark, using touch on phones.
Look for table bleed, clipped labels, overlapping controls, inert menus, hidden primary
actions, duplicate content, unclear next steps, stale organization data, confusing
terms, broken focus/keyboard behavior, loading/error/retry/empty states and accessibility.
Map each user journey before judging it. Simplify and consolidate; do not add feature
scope or architecture to compensate for poor presentation. Reuse existing components.
Record actual routes/actions/outcomes and screenshots for findings, fix concrete issues,
rerun affected browser flows, and leave an exact changed-file/evidence report for the
root reviewer. Never claim full coverage from screenshots or a few happy paths.
