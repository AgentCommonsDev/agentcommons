# Verdict (5 lines max)

The spec is not implementation-ready: it combines a useful retrieval service with several optional products and unresolved capture guarantees.
Keep message-level search, bounded expansion, SQL, raw records, explicit session links, database-enforced visibility, and redaction.
Defer embeddings, live tool-schema customization, compatibility channels, and most dashboard analytics.
Spend the saved effort on durable ingest, trustworthy retrieval references, and complete purge/redaction behavior.
The highest-value granularity is messages, source identity, file operations, and provenance—not more filter keys or configuration switches.

# Top simplifications, ranked by (impact / effort)

Ranking considers implementation avoided, ongoing maintenance, and the effort required to make the narrower design sound.

1. **Defer embeddings entirely.**
   - **Change:** Move §11 out of v1. Retain `searchText` and a stable search response so semantic ranking can be added later without changing callers.
   - **Removes:** Two tables, vector indexes, five provider adapters, chunking, catch-up/reindex commands, budgets, spend accounting, jobs, dynamic `mode`, `similar`, and a large test matrix.
   - **Risk:** Conceptual queries have lower recall. Measure this with actual searches before selecting one provider.
   - **Affected:** §§1, 3–4, 7–8, 10–11, 13, 16–18; Appendices B–C; supersede ADR 0006.

2. **Make the MCP catalog stable.**
   - **Change:** Publish fixed schemas and descriptions. Remove live facet examples and per-request description generation. If admin tools remain, use a simple permission filter over a static registry and authorize every invocation.
   - **Removes:** Facet refresh jobs, visibility-sensitive catalog caches, top-50 value lists, schema changes driven by corpus contents, and assumptions about clients re-listing.
   - **Risk:** An agent occasionally needs a SQL query to discover an unfamiliar repository or tool name.
   - **Affected:** §§3.1, 7.2, 8.2–8.3, 16; Appendix C.

3. **Use explicit adapters instead of building a route-to-tool framework.**
   - **Change:** Keep shared Zod schemas and services. Register the few MCP tools explicitly with the SDK; register REST routes explicitly with Fastify. Generate OpenAPI from routes.
   - **Removes:** Generic params/query/body merging, route introspection, `describe(ctx)` plumbing, custom registry conventions, and framework-specific handling of transport differences.
   - **Risk:** A little adapter wiring repeats. Schema and service reuse prevent substantive duplication.
   - **Affected:** §3.1, §§7.6, 8.1–8.3; reconcile CLAUDE.md’s competing tool-module definition.

4. **Reduce `get` to one bounded message reader.**
   - **Change:** Keep `session_id`, `from`, and `to`; remove `full`. Use identical expansion behavior with and without a range. Return a compact header, bounded content, and continuation. Put full files/commits/tree inventories in SQL or dedicated dashboard reads.
   - **Removes:** Range-dependent semantics, tool-stub generation, repeated inventories, and the misleading promise of “all messages.”
   - **Risk:** Default reads contain more tool text; control that with fixed content budgets and pagination.
   - **Affected:** §§4.4, 7.3, 8.2, 10, 16; Appendix C; supersede the relevant part of ADR 0003.

5. **Cut the search filter vocabulary to routine retrieval needs.**
   - **Change:** Retain repository, branch, user email, tool name, file prefix, role, session ID, and time bounds. Move device, harness, model, tags, issue keys, kind, and commit predicates to SQL.
   - **Removes:** Eight filter families from validation, SQL translation, facet discovery, dashboard controls, descriptions, and tests.
   - **Risk:** Specialist investigations need SQL. That is already SQL’s purpose.
   - **Affected:** §§7.2, 7.6, 8.2–8.3, 10, 16; Appendix C.

6. **Ship one investigation channel and one guidance mechanism.**
   - **Change:** Keep MCP and a short optional repository-instructions snippet. Defer search/get/sql CLI commands, compatibility wrappers, and automatic skill installation. Hook `install`, `doctor`, and `uninstall` remain operational commands.
   - **Removes:** Another flag parser, executable installation, shell-output contracts, wrapper collisions, skill distribution, and three copies of delegation instructions.
   - **Risk:** pi needs an actual MCP adapter or a small CLI when its support lands; implement that dependency at that phase.
   - **Affected:** §§3.1, 6.1, 8.4–8.6, 16–17; Appendix C.

7. **Replace the full dashboard with the workflows needed to operate the service.**
   - **Change:** Ship login, search/session list, transcript detail, key management, and compact admin controls for users, visibility, purge, and audit. Poll active sessions every five seconds.
   - **Removes:** SSE plus fallback, command palette, graph rendering, six detail tabs, universal virtualization, SQL IDE, charts, device page, saved queries, relevance labeling, and extensive exports.
   - **Risk:** Humans doing advanced analysis initially use SQL through an agent or REST.
   - **Affected:** §§7.6, 9–10, 16–17.

8. **Make redaction configuration declarative and deployment-controlled.**
   - **Change:** Keep secretlint and organization patterns. Load one validated configuration at startup; initially provide an operator test command and use purge for incidents. Defer policy CRUD and rescans until their complete data-rewrite semantics are specified.
   - **Removes:** `RedactionPolicy`, database/env reconciliation, cache invalidation, arbitrary rule loading, policy administration, rescan orchestration, and partial-rewrite hazards.
   - **Risk:** Adding a rule requires a restart; correcting historical data requires purge. If live editing is mandatory, retain regex-only CRUD and a fixed installed-rule allowlist.
   - **Affected:** §§3, 4.3, 5.3, 7.6, 10, 16; Appendix B; update CLAUDE.md’s policy requirement.

9. **Start session relationships with an adjacency list.**
   - **Change:** Store explicit parent references and relation types. Derive root, depth, and descendants with recursive SQL. Keep unresolved native parent references on the child row. Treat resume as a lifecycle event, not an edge.
   - **Removes:** Closure-table triggers, subtree recomputation, `PendingLink`, redundant `rootSessionId`/`depth`, and speculative prefix-based fork detection.
   - **Risk:** Deep or frequent tree traversals may eventually justify materialization. Missing explicit fork metadata means an unknown parent.
   - **Affected:** §§4.2, 4.5, 5.5, 7.4, 9.5, 12, 16; ADR 0009 consequences.

10. **Stop storing speculative session analytics.**
    - **Change:** Keep native identifiers, ownership, repository/branch, timestamps, basic counts, observed models/tools, explicit file operations, and optional Git boundary observations. Defer `TagEvent`, Linear extraction, shell-command file inference, and end-of-session diff/commit attribution.
    - **Removes:** Event-sourced tagging, vendor-specific issue semantics, shell parsing, Git subprocess work, and unreliable “what shipped” claims.
    - **Risk:** Some analytics require later enrichment. Retained raw records preserve most opportunities.
    - **Affected:** §§4–6, 7.4, 10, 12, 16.

11. **Consolidate shim retries around one pending batch per session.**
    - **Change:** Retry an existing durable batch before rereading its source range. Keep the acknowledged cursor, pending terminal metadata, and pending batch identity together. Run retry/sweep work only in the uploader.
    - **Removes:** Repeated overlapping spool files during outages and network work ambiguously assigned to every hook invocation.
    - **Risk:** Queue transitions must survive crashes. This is necessary complexity; verify the transitions directly.
    - **Affected:** §§5.1–5.2, 6.2–6.4, 12, 16; ADR 0005.

12. **Stage harness support and verification by evidence.**
    - **Change:** Launch supported adapters when their captured contracts and replay tests pass. Keep Gemini and pi as later phases until mutable-message and branch semantics are resolved. Retain the reader/normalizer/mapping boundaries.
    - **Removes:** Four-harness launch coupling and implementing guesses as supposedly verified contracts.
    - **Risk:** Delayed support for two harnesses; no architectural loss of harness independence.
    - **Affected:** §§1, 3.1, 5.4–6.3, 12, 16–17; Appendix A; README support claims.

# Agent interface: field-by-field

This covers every specified search/get/sql argument, including the conditional and REST-only arguments.

| Argument or filter | Decision | Reason grounded in tool use |
|---|---|---|
| `search.query` | **Keep** | The usual call is a topic, identifier, or error; document websearch semantics and allow empty text only with a nonempty filter. |
| `search.filters` | **Keep** | Structured constraints prevent agents from inventing qualifier syntax. |
| `search.context` | **Keep** | `0` supports quick scanning; `1–3` supplies evidence around a hit without another call. |
| `search.limit` | **Keep** | Agents need a direct way to bound cost; define it as hit messages before window merging. |
| `search.mode`, embeddings on | **Cut** | Agents should ask questions, not select retrieval algorithms; future hybrid ranking can be internal. |
| `/search.cursor`, REST only | **Change** | Either expose the same continuation through MCP or remove it; exhaustive investigations cannot depend on dashboard-only paging. |
| `filters.repo` | **Change** | Use `repo_name`; accept an exact canonical `host/org/repo`, with a short name only when unambiguous. |
| `filters.branch` | **Keep** | “What happened on this branch?” is routine; specify exact matching and preferably pair with repository. |
| `filters.user` | **Change** | Use `user_email`; display names are ambiguous and agents otherwise cannot predict resolution. |
| `filters.device` | **Cut** | Machine-level questions are operational analytics and fit SQL. |
| `filters.harness` | **Cut** | Most prior-work questions cross harnesses; adapter diagnostics fit SQL. |
| `filters.model` | **Cut** | Model comparison is analytics, not routine evidence retrieval. |
| `filters.tool` | **Change** | Use `tool_name`, matching tool-use/result messages directly, not every message in a session that used the tool. |
| `filters.tag` | **Cut** | No demonstrated tagging workflow justifies a retrieval filter and mutation surface. |
| `filters.linear_key` | **Cut** | Search the literal issue key; a Linear-specific filter contradicts the otherwise generic deployment model. |
| `filters.file` | **Change** | Keep a repo-relative prefix, call it `file_prefix`, and state that it selects sessions touching the path—not messages about that file. |
| `filters.role` | **Keep** | Finding user requests versus assistant conclusions or tool evidence is useful granularity. |
| `filters.kind` | **Cut** | It overlaps role/tool selection and exposes normalization details; uncommon combinations fit SQL. |
| `filters.session_id` | **Keep** | Searching within a long session is a common follow-up that bounded `get` cannot replace efficiently. |
| `filters.since` | **Change** | Define as inclusive message time; a session-start filter misses yesterday’s work in a week-old session. |
| `filters.until` | **Change** | Define as exclusive message time in UTC, making adjacent investigation intervals composable. |
| `filters.has_commits` | **Cut** | Recorded commits are not reliable proof of work shipped; SQL can express the narrower observation with explicit completeness conditions. |
| `get.session_id` | **Keep** | It is the stable reference returned by search. |
| `get.from` | **Change** | An inclusive stable sequence lower bound; it must not implicitly change expansion behavior. |
| `get.to` | **Change** | An inclusive upper bound; retain precise range reads and reject `to < from`. |
| `get.full` | **Cut** | It changes both thinking visibility and tool expansion, and is partly redundant with ranges. |
| `sql.sql` | **Keep** | One SQL string is sufficient; do not add filter objects, formatting switches, or psql commands. |

For retained categorical filters, keep scalar-or-array values with OR within a field and AND across fields. Reject empty arrays and unknown keys. Time bounds are scalar. Do not generate enums from database contents.

`context` is worth keeping, but it counts normalized messages, not conversational turns. One neighboring message can be another tool call rather than the explanation an agent needs. Include `tool_use_id` on tool messages so a caller can find the corresponding input/result. Keep the fixed maximum of three instead of adding turn-aware or tool-aware context modes.

The search result should keep contiguous message windows, explicit hit markers, `session_id`, `seq`, and truncation flags. Change three things:

- Use consistent names: `repo_name`, `user_email`, and `content`; the current `repo`, `user`, and `text` do not match SQL.
- Return excerpts around the match. Prefix-only trimming can hide the exact text that made a message relevant.
- Remove public `score` and routine timing from the agent-facing text. Scores are not confidence, and lexical/RRF scores are not interchangeable.

A default of five hits and a response budget around 32 KB is a better starting point for agent calls than 256 KB. Keep a larger transport ceiling if needed. Distribute hits across sessions with a fixed internal per-session cap, so a noisy session cannot consume the whole first response.

`get` is necessary. SQL’s 2 KB cell truncation makes it an inadequate replacement for reading evidence. Return a compact header—identity, title, repository, branch, author, timestamps, message count, and visible parent/child references—plus messages and continuation. A single oversized message also needs content continuation; advancing only `next_from` cannot retrieve its omitted tail.

For SQL, keep `columns` and positional row arrays: they avoid repeating column names and preserve duplicate names in joins. Define truncation explicitly, including which cells were shortened. Drop unstructured `warnings` unless there are specified warning codes.

The admin tools should be assessed separately from investigation:

| Tool and all its arguments | Decision | Reason |
|---|---|---|
| `set_visibility(session_id, visibility, reason)` | **Defer MCP exposure** | Keep the admin endpoint/dashboard action; no stated workflow requires an investigating agent to moderate sessions. All three arguments are justified if later exposed. |
| `purge(session_id, reason)` | **Defer MCP exposure** | Destructive maintenance can remain an explicit admin operation; an MCP annotation does not itself provide confirmation or authorization. |
| `audit(filters, limit)`; filters `user`, `key`, `ip`, `action`, `resource`, `since`, `until` | **Defer MCP exposure** | Keep dashboard/REST audit lookup; later use exact user/key/resource IDs, UTC bounds, and continuation rather than inventing another name-resolution layer. |
| `status()` | **Defer MCP exposure** | Dashboard readiness, ingest failures, and queue state cover initial operations; the embedding metrics disappear with §11. |

If admin MCP tools are required at launch, static permission-based listing is inexpensive and reasonable. Dynamic schemas based on caller data are the complexity to reject.

# Cut / defer list

- **Keep — `search` / `get` / `sql`:** These represent three different agent tasks and avoid forcing ordinary retrieval into SQL.
- **Cut — one-box grammar remnants:** Replace `file:` prose and positional pseudo-calls with actual JSON examples; do not imply a second filter language.
- **Cut — psql shortcuts:** Four rewrite rules add another language when ordinary schema queries already work.
- **Defer — compatibility search/fetch wrappers:** The proposed `search` name collides with the existing tool, and no launch client requires them.
- **Defer — investigation CLI:** Shared services do not eliminate flag parsing, installation, help, formatting, and testing costs.
- **Cut — automatic skill installation:** It duplicates descriptions/snippets and requires a distribution/update lifecycle.
- **Change — three subagent-guidance levers to one snippet:** Delegation depends on the caller’s capabilities and policy; it should not dominate every tool description.
- **Defer — `SavedQuery` and `query_examples`:** Put a few examples in documentation; a publishing workflow is not necessary for SQL discovery.
- **Keep — compact schema discovery:** Agents need column names and types; one `/schema` representation and SQL-readable catalog views suffice.
- **Cut — exhaustive schema text in every tool listing:** List core views and a discovery query; avoid injecting dozens of rarely used columns into context.
- **Cut — custom SQL error enrichment:** Return a safe PostgreSQL error code/message/position and point to schema discovery.
- **Cut — facet suggestions and zero-hit query synthesis:** They introduce extra queries, ranking, caches, and privacy rules for a recoverable empty result.
- **Keep — a small golden search suite:** It tests the product’s central behavior; include identifiers, errors, long outputs, and session diversity.
- **Defer — dashboard relevance marks and fixture export:** Building a labeling product is unnecessary to maintain a small regression corpus.
- **Keep — transcript readers and normalizers:** Storage format and semantic interpretation are genuinely different responsibilities.
- **Change — six canonical events to four behaviors:** `start`, throttled `sync`, forced `sync`, and `end`, each with a source transcript and optional parent metadata; retain the native event name for diagnostics.
- **Defer — pi extension until pi support lands:** It is the necessary bridge for that harness, not a general plugin framework.
- **Cut — `Normalizer.detect(line)` dispatch:** The authenticated envelope already identifies the harness; validate records inside the selected normalizer.
- **Cut — `RESUME` parent edges:** A resumed native session remains the same session.
- **Cut — three-record fork heuristics:** Shared prefixes establish common content, not necessarily parentage.
- **Defer — closure-table materialization:** Recursive traversal over an adjacency list is enough until measurements disagree.
- **Defer — `TagEvent`, tag mutation, and Linear extraction:** They create workflows unrelated to automatic capture.
- **Change — device identity to a random installation UUID:** Hardware fingerprinting adds OS-specific commands without improving key-based attribution.
- **Defer — shell command parsing for files:** Keep explicit file-tool inputs and structured patches; arbitrary shell commands are not a reliable file-access log.
- **Defer — multiple email transports and simultaneous login families:** Support one configured identity path plus local bootstrap; reuse Better Auth.
- **Keep — scoped keys, visibility, purge, and audit:** A shared transcript corpus needs these even with a small team.
- **Cut — duplicate MCP/operation audit rows:** Record one logical operation with transport and tool metadata.
- **Defer — SSE, graph views, charts, SQL IDE, and universal virtualization:** Polling, linked parent/child lists, and a bounded transcript viewer cover initial use.
- **Cut — dynamically recorded route-hit coverage gates:** A test hitting an endpoint does not establish that its behavior is correct.
- **Cut — the 85% global coverage gate and workstation sign-off:** Gate on critical invariants and reproducible tests.
- **Cut — full Cartesian feature-flag testing:** Deferring optional features removes most of the matrix; test remaining configurations selectively.
- **Keep — real Postgres and installed-artifact tests:** Mocked SQL and source-only shim tests would miss the dangerous failures.
- **Defer — generalized infrastructure variants:** Keep the required AWS deployment and working Compose path; do not build several network/worker topologies before demand.

# Gaps and risks

- **The ten-second crash-loss guarantee is false for an event-driven throttle.** After a skipped event, nothing schedules a sync at the deadline. A long tool call, idle session, network outage, or lack of another hook can leave data unsynced indefinitely. State the guarantee as “event-triggered, usually within ten seconds during activity,” with eventual retry on later hooks. If ten seconds is a hard deadline, a timer/poller is required. §§1, 6.3, 12.

- **Lock contention can discard the final sync request.** A `Stop` or `SessionEnd` arriving while an uploader holds the lock becomes a no-op, even if that uploader already read EOF. Persist sync/end intent before returning; the uploader must recheck pending intent and source growth before releasing ownership. Do not hold a hook open waiting for the uploader. §§6.2–6.4.

- **Active subagents do not satisfy the advertised capture guarantee.** The Claude fixture’s child `PostToolUse` events contain `agent_id` but the parent `transcript_path`; the child path appears at `SubagentStop`. Syncing only the supplied transcript misses ongoing child work and a child that never stops. Register child sources on child events using the verified layout, then include them in normal sync/recovery. Appendix A; §§5.4, 6.3, 12.

- **Record identity is not specified sufficiently for deduplication.** Codex uses an “ordinal” that the envelope does not transmit; an end cursor cannot identify every line across split/retried batches. Hashing identical lines can collapse legitimate repeated records. Carry stable per-record source identity/position, independent of redaction and arrival order. Allocate normalized block identities deterministically from that source record. §§4.3, 5.1–5.2.

- **Gemini’s index cursor cannot capture mutations to an existing message.** If a message acquires text, tokens, or tool results without a new array element, “past the last synced index” emits nothing; dedupe by message ID then rejects any later version anyway. Capture a live example that establishes mutation behavior. If mutable, use native ID plus revision/content hash for raw versions and define the current normalized projection, or defer Gemini. §§3.1, 5.4, 12.

- **Arrival order and transcript order disagree.** Retries can deliver old records after newer records, while §5.2 assigns `seq` by arrival and §7 uses it for neighbors. Sorting by timestamp elsewhere does not fix those windows. Define source order as authoritative and make retrieval references stable under late arrival; prohibit newer ranges overtaking an unacknowledged earlier range. §§4.3, 5.2, 7.2–7.3, 12.

- **Purge leaves content behind and permits resurrection.** Commit subjects, paths, branch names, tags, `TagEvent`, and audit text can contain the leaked material. New ingest and queued jobs can recreate deleted messages. Define an exhaustive purge manifest, serialize purge against ingest, reject subsequent appends to tombstoned sessions, and make every worker check tombstones. Document separately what remains in audit and backups. §§5.2, 9.5, 11.

- **Rescan is incomplete even on its own terms.** It rewrites `content`/`searchText`, but leaves `RawRecord`, `toolInput`, titles, first prompts, chunk text, and other derivatives. Either remove it from v1 or rebuild every affected representation from a redacted source in a defined maintenance operation. §5.3.

- **“Redact before any write” excludes several actual write paths.** Envelope fields, Git commit subjects, tags, audit query/SQL text, and error details can contain secrets. The local spool also contains unredacted transcripts, contradicting README’s “never reach disk.” Apply redaction to all server-persisted free text, protect local spool/state files, and narrow the README claim. §§5.1–5.3, 6.4, 9.3; README.

- **Sensitive-file suppression requires cross-record correlation.** The tool input naming `.env` may have arrived in an earlier batch than its result. Line-local redaction cannot enforce that policy. Resolve tool results to inputs by session and `tool_use_id` before persisting either raw or normalized result content. Define fail-closed handling when provenance is missing. §§5.3–5.4.

- **The SQL visibility boundary needs security-barrier views.** A plain `WHERE visibility = …` view can expose hidden values through evaluation of caller expressions, including errors. Specify `security_barrier` for row-filtering views, and make exposed functions execute as invokers over those views. PostgreSQL explicitly documents this requirement. [PostgreSQL view security](https://www.postgresql.org/docs/16/rules-privileges.html). §7.5; ADR 0004.

- **`search_path = api_ro` does not mean “only api_ro is accessible.”** `pg_catalog` remains implicitly searchable; unqualified catalog relations/functions need handling. Validate relation references against allowed views and CTE bindings, restrict callable functions, and verify actual grants and transaction settings. Do not present the denylist as exhaustive protection. [PostgreSQL schema search rules](https://www.postgresql.org/docs/16/ddl-schemas.html). §7.5.

- **Derived metadata can reveal private sessions.** `parent_title`, parent IDs, child counts, tree rows, repository counts, devices, users, and cached facets do not automatically inherit the child session’s visibility predicate. Derive them only from the caller-visible session set. Prefer a null parent when the actual parent is hidden; synthetic reparenting invents a relationship. §§7.4–7.5, 8.3, 9.5.

- **Admin-owned read keys appear to inherit admin visibility.** Pool selection uses the owner’s role, while administrative tool exposure uses key permission. Define effective authority once: a key accesses admin visibility only when its owner is an admin and the key has the required admin permission. Test admin-owned read-only and ingest-only keys explicitly. §§3.1, 7.5, 9.2.

- **The default bootstrap can turn an unverified email into admin identity.** With email/password enabled, email transport disabled, verification skipped, and bootstrap based on matching email, possession of that address has not been established. Bootstrap through an operator-generated one-time credential or seed operation; require valid invitations for subsequent local accounts. §9.1.

- **SQL topic counts silently count only the top matches.** The §7.4 example aggregates `search_messages(..., 500)`, so a topic with more than 500 matching messages produces incomplete counts. Make the composable SQL search function return an uncapped relation; apply hit limits in `search` and output limits after SQL aggregation. Timeouts remain the cost bound. §7.4; Appendix C.2.

- **The main failure-search use case misses output tails.** Only the first 2 KB of tool results is searchable, but test/compiler failures often appear after setup output. Index bounded head and tail portions; provide a documented SQL literal-content lookup for text outside the ranked portion. Do not describe `simple` text search as arbitrary substring matching. §§1, 7.1–7.2.

- **Search can return a hit without its supporting evidence.** Prefix trimming hides matches late in a prompt/reply, and SQL/get limits may hide the remainder. Use match-centered excerpts and content continuation. The C.4 answer also claims files and commit counts that C.3’s search response does not provide: either fetch them or remove that one-call claim. §§7.2–7.4; Appendix C.

- **A single record can exceed the entire retrieval response limit.** `get` promises up to 1 MB of record content inside a 256 KB response. Whole-message dropping can yield an empty page or an inaccessible message. Define within-message continuation, and apply caps to both ranges and unbounded reads. §§4.4, 7.3.

- **Stateless MCP does not imply re-listing on every request.** Clients can cache catalogs; the specification explicitly supports deterministic, cacheable tool lists. Remove the “changes appear immediately” guarantee and test against the pinned SDK/protocol version. [MCP tool-list specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/server/tools.mdx). §8.3.

- **Git observations are presented as attribution.** `startHead..HEAD` includes commits by other processes and can be invalidated by branch changes or rebases. A Git common directory is also not the current worktree root. Keep observed start/end SHAs, distinguish worktree root from repository identity, and label inferred ranges as observations rather than commits “made during the session.” §§4.2, 6.3, 12.

- **Audit-after-response cannot guarantee every successful mutation is audited.** A process can die after commit or response but before `onResponse` writes. Store mutation audit rows in the mutation transaction; persist read audit before completing the response. Carry transport metadata in the same event, including failures that never reach a service. §§3.1, 8.1, 9.3.

- **The installer’s upgrade and uninstall lifecycle is brittle.** It downloads and replaces `hook.js` before uninstalling, so uninstall requires a working server. Unversioned immutable caching can serve stale upgrades or mismatched script/checksum pairs. Uninstall with the installed artifact; publish versioned artifacts with a manifest, stage upgrades beside the target, and replace atomically. Preserve user configuration and use an exact owned-hook marker. §6.1; [install.sh](/home/user/agentcommons/apps/api/public/install.sh).

# Under-specified

- **One normative contract:** Sections 7–8 and Appendix C disagree on names, harness enums, disabled embedding visibility, and response contents. Default: generate Appendix C schemas/examples from the same fixtures used by contract tests.
- **Scalar enum validation:** C.1 places `enum` under `items`, constraining array elements but not scalar strings. Default: explicit scalar-or-array unions whose scalar schema carries the enum.
- **Canonical envelope events:** §3.1 defines canonical events, but §5.1 accepts only Claude/Codex-style names plus `Sweep`. Default: transmit a canonical behavior and a separate native event name.
- **Client state:** The defined state lacks transcript path, reader kind, opaque cursor, pending end metadata, and enough context for a sweep. Default: specify one complete versioned state schema.
- **Acknowledgment meaning:** Default: `202` means the full batch and its mutation audit have committed; no partial acceptance without per-record acknowledgments.
- **Metadata idempotency:** Record dedupe does not dedupe resume markers, terminal transitions, tags, or counters. Default: stable event identity and updates based only on newly accepted records/events.
- **Retry classes:** Default: retry network errors, 429, and 5xx with backoff; suspend and report 401/403/409; handle 413 by splitting; quarantine a permanently invalid record without blocking unrelated sessions.
- **Lock lifetime:** “Stale after 60 seconds” can evict a living uploader. Default: explicit owner identity plus bounded uploader lifetime; test expiry races and crashed owners.
- **Installation boundary:** Resuming a pre-install transcript from cursor zero backfills it despite ADR 0008. Default: explicitly decide whether the boundary is session creation or first post-install observation, then test resumed old sessions.
- **Lifecycle freshness:** `STALE` is not proof that a process died. Default: derive it from server receipt time, display it as inactivity, and preserve native ended/resumed events separately.
- **Status precedence:** A delayed `SessionEnd` can arrive after a newer resume. Default: apply lifecycle events by source order, not receipt order.
- **Missing and malformed timestamps:** Default: retain source timestamps when valid, record receipt time separately, and never use timestamps as message identity.
- **Token counters:** Codex usage can be cumulative, while other records report per-message values. Default: explicit adapter rules; unknown values remain null and retries never increase totals.
- **Tool correlation:** Default: populate tool name on both use and result messages; pair by native tool ID, not adjacency.
- **pi active branch:** `getLeafId()` is listed, but the envelope and model do not preserve the selected leaf. Default: defer branch-aware rendering until active-leaf updates and message ancestry have a shared representation.
- **Conflicting parent hints:** Default: explicit native metadata outranks environment hints; conflicting hints are recorded diagnostically and never silently relink a tree.
- **Repository normalization:** Default: strip credentials and `.git`, normalize recognized SSH/HTTPS forms, preserve host/org/repo identity, and reject ambiguous short-name lookup.
- **SQL naming:** `sessions.id` versus result `session_id` is a reasonable documented relationship; `repo`/`repo_name`, `user`/`user_email`, and `text`/`content` are avoidable drift. Default: one public vocabulary.
- **SQL limits and encoding:** Default: fetch 501 rows to detect the 500-row cap; preserve big integers/precise decimals as strings; specify duplicate-column handling, UTF-8 byte limits, and cell truncation.
- **Search pagination:** Default: deterministic ordering with an explicit tie-breaker and opaque continuation tied to the query; do not promise snapshot completeness while new ingest changes ranking.
- **Empty-query behavior:** Default: return one recent anchor per matching session, so listing recent work does not produce ten messages from the same session.
- **Header bounds:** Files, commits, and children can themselves exceed the response budget. Default: counts and a small bounded reference list; detailed enumeration through SQL.
- **Compressed request limits:** “10 MB after gzip” is ambiguous. Default: specify separate compressed and decompressed limits and stream decompression under the latter.
- **Oversized structured records:** Cutting JSON bytes invalidates JSON. Default: parse/redact first, replace oversized content leaves while preserving valid structure, and describe storage as redacted/sanitized rather than exact raw fidelity.
- **Redaction rule execution:** “Any published rule” does not explain installation or resource limits. Default: only preinstalled rules; bound regex execution and reject invalid configurations before activation.
- **Permissions:** Tag mutation currently requires only `sessions:read`; key-management routes say “any.” Default: read scopes cannot mutate content or mint broader credentials.
- **Private semantics:** Private sessions are admin-only, including against their uploader. Default: name this clearly in the UI; do not imply conventional owner-private access.
- **IP attribution:** Default: use the framework’s trusted-proxy chain resolution, not the first user-influenced forwarded header value.
- **Audit scope and retention:** Default: audit authenticated operations and authentication failures, not routine health polling/static assets; set a retention period and size bound for free-text detail.
- **Dependency boundaries:** `core` depends only on Zod but also owns secretlint-based redaction. Default: permit the required dependency or move redaction into its own package.
- **Operational exit codes:** “Every path exits 0” conflicts with an effective `doctor` and installer failure handling. Default: capture hooks fail open; installation/doctor report nonzero failure.
- **Local deployment:** README’s Compose quick start conflicts with §14’s Compose-for-Postgres plus `pnpm dev`. Default: provide separately tested self-host and development commands.
- **Verification proportionality:** Default: replay fixtures and run real-Postgres integration on PRs; run paid live harness smoke tests on adapter changes/releases and a scheduled canary.
- **Verification gaps:** Add kill-point tests around spool/ack/cursor transitions, out-of-order batches, duplicate terminal events, mutable Gemini messages, oversized retrieval, purge-versus-ingest races, and low-scope admin-owned keys.
- **Verification ceremony:** Replace raw payload equality with required-field/type compatibility checks, fake-timer latency claims with real child-process timing, and “macOS-like Docker” with an actual macOS runner.
- **Harness-specific assertions:** §16.1 requires linked subagents for every harness although Gemini/pi have no assumed native support. Default: a capability matrix determines each harness’s required assertions.

# Proposed spec edits

1. **Rewrite v1 scope in §§1, 17–18:** three retrieval tools, verified initial adapters, reliable capture, basic dashboard, scoped auth, visibility, purge, and audit; move optional products into named later phases.
2. **Supersede affected ADR decisions:** 0003 for the smaller interface, 0005 for accurate durability/latency guarantees, 0006 for deferred embeddings, and 0009 for staged support and explicit branch limitations.
3. **Replace §§7.2–7.3 and Appendix C.1 with one normative tool contract:** reduced filters, unchanged `context`, bounded `get` without `full`, consistent field names, and common pagination semantics.
4. **Specify retrieval budgets in §§4.4, 7.2–7.4:** match-centered excerpts, message and content continuation, bounded headers, deterministic ordering, and explicit SQL truncation.
5. **Simplify §7.4’s SQL helper:** expose `search_messages(q)` as an uncapped lexical match relation; use ordinary SQL predicates for analytical filters and apply outer limits after aggregation.
6. **Narrow §§8.2–8.6:** fixed catalogs, optional static admin permission filtering, one guidance snippet, no facets, psql shortcuts, compatibility wrappers, or investigation CLI in v1.
7. **Replace §3.1’s generic registry with explicit adapters:** shared schemas/services, generated OpenAPI, and one authorization/audit context.
8. **Rewrite §§5.1–5.2 around source identity:** per-record positions/IDs, deterministic normalized references, metadata idempotency, source ordering, and committed acknowledgments.
9. **Rewrite §§6.2–6.4 as a small durability state machine:** pending intent, one pending batch, lock ownership, acknowledgment, cursor advance, retry, and recovery; put network/sweep work in uploaders.
10. **Correct §§5.4–5.5, 12, and Appendix A:** active subagent source discovery, resume semantics, explicit forks only, deferred Gemini mutation handling, and deferred pi branch rendering.
11. **Reduce §4:** adjacency-list relationships, no `TagEvent`/`SavedQuery`/embedding tables, random installation identity, explicit file operations, and clearly labeled Git observations.
12. **Replace §5.3 and tighten §9.5:** deployment-controlled rules, redaction of every persisted free-text path, complete purge manifest, tombstone enforcement, and no partial rescan feature.
13. **Complete §7.5’s security contract:** security-barrier views, invoker functions, visible-only derived metadata, relation/function validation, and effective key authority.
14. **Narrow §§9–10:** safe bootstrap, one configured login path, atomic mutation audit, bounded retention, core admin workflows, and polling-based transcript updates.
15. **Align §6.1 with installer lifecycle requirements:** offline uninstall, versioned/atomic upgrades, exact hook ownership markers, configuration preservation, and distinct operational exit codes.
16. **Replace §16’s ceremony with invariant-driven verification:** deterministic replay, real Postgres, installed artifacts, failure injection, a small search-quality corpus, and capability-specific live canaries.
17. **Regenerate Appendix C and reconcile README/CLAUDE.md:** remove stale two-harness schemas, nonexistent one-call evidence, contradictory network/audit rules, and unqualified capture/redaction guarantees.