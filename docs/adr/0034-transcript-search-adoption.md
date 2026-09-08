# 0034: Measure search adoption from captured tool calls

Status already measures server-side MCP requests and approximate session attribution
through installation activity windows. The user also wants direct session evidence of
AgentCommons use and searches that follow it. Keep the two evidence sources distinct.

Add one caller-visible search-session relation over the current canonical message
projection. It counts exact, live-verified tool identities, deduplicating native call IDs
within each session. It never interprets arbitrary shell commands or generated programs
as proof of a search. Typed nested MCP completions require adapter support where the
native transcript records them separately from an outer execution tool.

The first AgentCommons search defines a source-order boundary. Later AgentCommons calls
are repeat searches; later recognized code/web search tools form a separate count. Both
are attempted invocations, including failed or incomplete calls. Successful server
responses remain available through the existing audit metrics. These observations do not
establish causation or estimate time saved.

Every member sees the current UTC week's aggregate on Home, restricted to their visible
sessions. Admin Status uses its existing date, repository, metric, sorting and CSV
controls. Both read the same database relation; no adapter reimplements classification
or counting. Sessions are selected by their start time. An empty session denominator
produces a null rate.

Unknown tool identities, arbitrary shell/program wrappers and external pi MCP bridges
without a verified contract are unclassified. A generic tool named `search` does not
prove that AgentCommons was called. Redaction can also remove an identity needed for
classification; counts remain conservative. The UI describes captured-tool coverage.

Tests must cover repeated observations, failed calls, source ordering, results/prose
false positives, current Gemini records and pi branches, visibility/purge, two
organizations, date/repository bounds and empty denominators. Live fixtures establish
the native names before implementation.
