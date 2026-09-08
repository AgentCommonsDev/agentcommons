# 0028: Observed reuse and organization metrics

Status: accepted for v1 implementation.

The expanded dashboard needs one definition of reuse for its weekly headline, session
counts, member impact and related-session lists. It also needs comparisons that do not
turn attribution gaps or missing measurements into fabricated outcomes.

## Canonical observations

`api_ro.session_base` owns the existing organization and private/purged visibility
boundary. Migration 012 renames the original view, preserving its dependent-view OID
references and column descriptions, then restores the public `sessions` view. Reuse
views read the base. Migration 013 decorates `sessions` with `reuse_count`; this avoids a
recursive dependency. The internal base is omitted from SQL discovery and the SQL guard.

`reuse_edges` is the only reuse relation. Its source is a session active on the reading
key's attributed installation, its target is a different caller-visible session, and its
read time is a successful `get` audit timestamp. Both sessions must remain nonpurged.
Only keys using MCP or REST qualify; human cookie views do not. The actual audit actor
supplies the reader user/email, and the source supplies the harness. Multiple simultaneously
active sessions on one installation can qualify: installation attribution cannot identify
which process asked. Operators should use a separate ingestion/read key on each machine.

Accepted lifecycle receipts supply source-time start/end boundaries. A synthetic initial
start covers capture before the first start hook. Start/end decisions use source watermark
and event time; a lower-position lifecycle receipt received after a newer transition cannot
close its window. Every accepted observation extends activity by at most six hours and an
end closes it sooner. Their union excludes gaps without an explicit end as well as gaps
between end and resume. Intervals include their start and exclude their end. Duplicate
receipts and overlapping windows do not duplicate edges. Source-clock skew limits historical
attribution; it is not replaced with a fabricated event clock.

The weekly denominator is caller-visible, nonpurged sessions started in the UTC ISO week.
A session with one or many qualifying reads contributes one numerator. Cross-user reuse
compares the actual read actor with the target owner. Session reuse counts distinct source
sessions, unique readers count distinct users, and member reuses made count distinct
source/target pairs. Reused-by/from lists use the latest read per peer session. Changing
visibility or purging changes the visible aggregates rather than retaining hidden totals.

## Audit identity and size

New `get` and `search` audits record returned database session UUIDs in the existing
`resourceIds` array. Search keeps result order and removes repeated session IDs; its first
ID is the top session. These server-owned identities have the same treatment as mutation
resource IDs, while user input and free-text detail still pass through redaction. Numeric
search hit count and truncation status are validated service metadata retained within the
8KB detail budget, even when a large input must be omitted. No user string or native ID
is exempted. Metrics accept legacy `detail.result` identities for older audits but do not
create speculative identities when metadata is unavailable. Tests cover policies matching
UUIDs and structural names, plus hundreds of filter strings that exceed the detail budget.
Declared search audit field names stay structural while query values and unknown JSON
keys remain redacted. A bounded redacted query preview survives whole-input omission,
so Home can still show an author their own zero-result searches. Member SQL returns
`NULL` for `memory_assisted`, whose complete search activity is visible only to admins.

## Metric definitions

The admin endpoint `/api/v1/admin/metrics/:group` returns typed, server-paginated rows.
All historical groups accept an inclusive UTC `date_from`, exclusive `date_to`, and exact
repo filter. Session metrics select session starts, capture metrics select receipt times,
redaction metrics select the responsible receipt time, and usage metrics select audit times.
Ratios return numerator and denominator and a null value for a zero denominator. Metadata
previews are bounded with explicit `truncated_fields`; stored SQL values stay complete.

Health coverage divides distinct installations with a visible receipt in the selected
interval's trailing seven days by current organization membership count. Multiple machines
per member can make the ratio exceed one; it is not the fraction of people who installed.
Median capture latency uses distinct native record/timestamp/receipt observations represented
by canonical messages. Missing timestamps have no sample; negative source-clock samples
are counted separately and excluded from the median. Authorization-blocked sessions mean a
missing, disabled, expired or non-ingest key, missing/suspended membership, or banned issuer;
this is not a claim to observe a client's local suspended spool. Redaction hits come from
redaction events joined to their visible session and responsible receipt.

Memory assistance uses the same active windows for key search/get/sql calls. Follow-through
counts a search when the same actor and installation gets a returned visible session within
10 minutes. Zero-result rate uses searches with an available numeric hit count; cross-user
hits use nonempty searches and their first visible returned session. A call's repo is its
active source repo, falling back to its visible read/top-result repo. Unattributed calls
remain in organization totals but not a selected repo. Dashboard weekly actives count
successful cookie operations; searches and views count search/get separately. MCP calls
map the seven registered service actions to their public tool names; protocol/list traffic
is excluded.

Outcomes group by the installation's **current** `tools_enabled` value and repo; toggling
regroups historical rows. They report averages with sums and session denominators, not
causal estimates. Near duplicates require another visible user's session in the same repo
within 30 days of the source start and either `pg_trgm similarity() > 0.6` or, when enabled,
cosine similarity `> 0.6`. The trigram threshold is explicitly `0.6::real` to match
its native score type; an untyped decimal promoted the comparison and admitted a score
displayed as exactly 0.6, which the boundary experiment caught. The selected date range chooses source sessions; candidate
sessions use the 30-day neighborhood. Embeddings-off queries cannot use retained vectors.
Re-run loops are a conservative text-evidence heuristic: the same test/build command occurs
at least twice with a paired failing-output marker. The nearest later result for each native
tool-use ID is used, so reusing an ID cannot make an earlier successful attempt fail. This
is not an inferred exit-status field. Observed commits require an ended session with at
least one observed commit; they do not attribute authorship to the agent.

Queue depth, embedding backlog and daily reserved spend remain live organization snapshots
on `/admin/status`, labeled as current state/current UTC day. The organization/day budget
cannot allocate query embedding reservations to a repo, so those cards do not pretend to
obey historical repo/date filters. No new reservation attribution was invented.

## Validation

Real PostgreSQL tests seed two organizations and two roles, explicit source clocks, end
and resumed windows, inactive gaps, repeated reads, hidden targets, wrong installations,
human reads and self reads. They assert exact rates and counts, filtering and pagination,
redaction hit totals and latency medians, current rollout regrouping, failed rerun evidence,
trigram/cosine boundaries, embeddings-off behavior and fail-closed auditing. The native
service audit test verifies that UUID redaction and oversized input cannot erase reuse
identity or turn a successful search into a zero result.

Reuse lists share one keyset pagination implementation between Home and session panels.
Text sorting uses the first 256 characters with C collation; timestamp sorting retains the
full timestamp, nulls sort last, and source/target UUID pairs break ties. The signed bounded
anchor remains usable if a previously visible row becomes private. Both surfaces use the
same optional reader filter and report truncated display metadata.
