## What changed

Updated [README.md](/home/user/agentcommons/README.md) only.

- Replaced the HTML masthead and repeated links with a title, description, and status.
- Compressed the problem and vendor comparison; removed invented scenarios and sweeping claims.
- Replaced promotional feature bullets with capture behavior, three MCP tools, and dashboard capabilities.
- Preserved the diagram; clarified detached uploads, searchable content, and message context. Removed the ten-second search guarantee.
- Marked setup as planned. Corrected the Compose claim and added the specified development commands, client prerequisites, key permissions, and Codex trust step.
- Preserved the verification table and removed pi’s unsupported “shipped here” claim.
- Scoped redaction to server storage and acknowledged local transcripts and upload spools.
- Consolidated documentation links and linked the license.

Completed the eval checklist and checked local links and code fences. No em dashes remain; technical “harness” terminology stays in the requested diagram and table.

## Detect

**(a) [CLAUDE.md, Writing](/home/user/agentcommons/CLAUDE.md:74)**

Pattern: **Colon reveal.**

> “Concise beats complete: cut anything the reader does not need to act.”

Fix: Delete the slogan before the colon; retain the editing instruction. The quoted examples of banned prose elsewhere in this section are instructional examples, not violations.

**(b) [SPEC.md, Appendix C.1](/home/user/agentcommons/docs/SPEC.md:1649)**

Pattern: **Tangled sentence**, in `search`.

> “Where possible, run the investigation in a subagent and have it return only the relevant findings with session ids: results can be large, and anything beyond a single lookup (more than 2-3 calls, or reading full sessions) belongs in a subagent, not in the main context.”

Fix: Separate the delegation threshold from the return format; state delegation once.

Pattern: **Tangled sentence**, in `get`.

> “Without a range: header (title, user, repo, branch, commits, files, parent, children) and all messages with tool inputs/outputs stubbed to one line and thinking omitted; capped at 200 messages, next_from to continue.”

Fix: Separate default output, truncation, and pagination into sentences.

The `sql` description is a placeholder pointing to C.2; C.1 supplies no SQL description to assess.

**(c) [SPEC.md, §10 Copy](/home/user/agentcommons/docs/SPEC.md:1109)**

Pattern: **Tangled sentence.**

> “Strings live in one module per app (`apps/dashboard/src/copy.ts`) so they can be reviewed in one place, and a CI check runs the skill's `eval.md` checklist over that module and over `README.md` via an LLM pass on PRs that touch them.”

Fix: Separate string storage from the CI requirement. Keep the file scope and PR trigger explicit.