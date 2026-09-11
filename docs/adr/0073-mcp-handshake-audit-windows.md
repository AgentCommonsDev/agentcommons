# ADR 0073: MCP handshakes are audited once per window, not once per connection

Date: 2026-09-11
Status: Accepted. Refines §8.1 and §9.3: "one AuditEvent per logical operation" (R-AUD-01)
keeps applying to operations; a protocol handshake is not one.

## Context

On 2026-09-11 the hosted instance received a `tools/list` handshake about every 2.4 s from
one workstation: 1,005 handshakes in under an hour, user agent `node`, around 4,500 audit
rows per hour (each handshake writes `mcp.protocol initialize`, `mcp.protocol
notifications/initialized` and `mcp.tools.list`), and before the registration fix the same
cadence of 401s. A real Claude Code session writes four rows once (`server/discover` 400,
`initialize`, `notifications/initialized`, `tools/list`) and then calls tools.

The source was found on the workstation, not in the server. The Gemini Code Assist
extension for code-oss (`google.geminicodeassist` 2.75.0) spawns
`agent/a2a-server.mjs` as a background process. Its startup runs a `discover_tools` phase
(3 to 4 s: `initialize` + `tools/list` against every MCP server in `~/.gemini/settings.json`,
including the `agentcommons` HTTP entry the installer wrote), then calls Google's
`cloudcode-pa.googleapis.com/v1internal:onboardUser`, which fails with either
`429 RESOURCE_EXHAUSTED` or `UNSUPPORTED_CLIENT` ("This client is no longer supported for
Gemini Code Assist for individuals ... migrate to the Antigravity suite of products"). The
extension logs `[CoreAgent] Error during startup`, `Process exited with code 1`, `Process
exited for restart, attempting to restart...` and respawns at once, with no backoff. The
agent log of one extension host recorded 571 starts in 46 minutes (one per 4.9 s); the
second open window's host recorded 2,299 in 170 minutes (one per 4.4 s); together one
spawn per 2.4 s, exactly the cadence seen on the server. `/proc` showed the two children
aged 0 to 4 s at every sample. Every restart repeats the discovery handshake because the
process is new; nothing in it is a reconnection our transport could have kept alive.

Our transport is stateless Streamable HTTP and compliant: no `Mcp-Session-Id` is issued, so
the client correctly sends none; `GET /mcp` answers 405, which the specification allows in
place of a standalone SSE stream; `server/discover` from Claude Code is a version probe the
SDK rejects with 400 and the client then negotiates normally. Session resumption would not
have helped a client that exits and restarts.

The class is real though: any client that re-handshakes at a high rate (a crash loop, a
keepalive `ping`, an IDE that re-discovers on every editor event) writes audit rows in
proportion, and those rows are protocol plumbing, not operations anyone reads back.

## Options

1. **Standalone `GET` SSE stream and session ids.** Fixes nothing here (the client process
   dies) and adds server state the stateless design avoids. Rejected.
2. **Coalesce handshake audit rows per key and client per window.** Every handshake is still
   counted; rows become one per identical handshake per window. Fixes the class for every
   client. Chosen.
3. **A per-installation handshake rate limit with a compliant response.** Answering
   `tools/list` from a cache while skipping the row is option 2 without the count; a 429
   would break discovery for a well-behaved client that happens to reconnect. Rejected.

## Decision

1. **A handshake is any MCP message that invokes no tool**: `initialize`,
   `notifications/initialized`, `ping`, `tools/list` and every protocol rejection (a
   `server/discover` probe, an unsupported method, a malformed body). `tools/call` is an
   operation and always writes exactly one row for what it did (`search`, `get`, `sql`,
   ..., or `mcp.call` for a call that failed).
2. **Identical handshakes are folded per window.** Identity is the API key, the client
   program (`User-Agent`), the action, the method and the status. The first handshake of a
   window writes its row at once, exactly as before. Repeats inside the window are counted
   in the process and write nothing. The handshake that opens the next window carries the
   count in its detail: `repeats` and `repeats_since` (when the row that opened the previous
   window was written). Two harnesses sharing one installation key (the live canary runs all
   of them on the member key) have different user agents and keep separate rows.
3. **The window is `MCP_HANDSHAKE_WINDOW_SECONDS`**, default 300; `0` audits every
   handshake (the previous behaviour, kept for the before/after measurement and for a
   deployment that wants it). The ledger is in-process, bounded (expired windows are pruned
   past 4,096 entries) and needs no table: a count in a window that no later handshake closes
   is not written, which loses at most one window's repeat count for one client on a restart,
   never an operation.
4. **Failures of the operation itself are never folded.** A `tools/list` that fails
   authorization or the audit store is audited per event through `auditedOperation` as
   before; only successful catalog listings and protocol messages fold.

## Consequences

- The Gemini Code Assist crash loop, or any 2.4 s re-handshake, writes three rows per five
  minutes instead of three per handshake. Measured on the local fixture (real PostgreSQL and
  ClickHouse, a 2.4 s loop for five minutes): 125 handshakes wrote 375 rows (4,500 per hour,
  the production figure) with the window off and 3 rows (36 per hour) with the default
  window; process CPU per handshake fell from 125 ms to 100 ms (the folded rows skip the
  audit transaction: redaction, installation lookup, insert and outbox row). Claude Code's
  handshake is unchanged on the wire (the MCP contract fixture is byte-identical) and its
  first session in a window still writes its four rows immediately.
- Readers of the audit log see the count on the next row for that client rather than one
  row per event. The canary's per-stage assertions hold because each harness is a different
  client program.
- Auth failures before a key is known (`auth.failure`, per IP) are a separate class with no
  key to fold on; the `auth` rate limit (20/min per IP) bounds them. Not changed here.
- Recommendation for the workstation: the extension's own restart loop is the fault. Until
  Google's `UNSUPPORTED_CLIENT`/quota failure is resolved, disable or uninstall the Gemini
  Code Assist extension in code-oss, or remove the `agentcommons` entry from
  `~/.gemini/settings.json` if the extension must stay; the Gemini CLI hook and its own
  registration are unaffected.

## Amendment 2026-09-11: budgets follow the same identity

Option 3 was rejected as a _per-installation_ handshake limit. One already existed:
`POST /mcp` spent 120 requests per minute per key for every message, handshake or tool
call alike. Between 18:51 and 19:19 UTC the same crash loop (about 114 handshakes per
minute from one workstation's key) exhausted that budget in the last seconds of most
minutes and was answered `429 RATE_LIMITED`. Every Claude Code and Gemini CLI session on
the machine shares the key, Claude Code loads MCP servers once at session start and drops
one whose `initialize` fails, so a session starting in those seconds would have had no
`agentcommons` tools for its whole life. Not observed yet; arithmetically likely within a
working day.

Rate limits protect resources. A handshake costs the server almost nothing; a `tools/call`
runs a bounded read. The MCP budget is therefore split along the identity of decision 2:

1. Handshakes (`initialize`, `notifications/initialized`, `ping`, `tools/list` and every
   protocol rejection) spend a `handshake` budget of 600 per minute per key **and** client
   `User-Agent`. The program that exhausts it is refused alone, with the `429 RATE_LIMITED`
   body and `Retry-After` header every route answers, and can never cost another program
   on the same key its `initialize`. The budget is generous because the identity already
   confines the damage: a loop restarting once a second (three handshakes) spends under a
   third of it.
2. `tools/call` keeps the `mcp` budget of 120 per minute per key in front of the readers,
   then the `read` or `sql` budget of the tool as before.
3. One limiter reads a table of categories (maximum and identity: `address`, `caller`,
   `client`) through the same `identities` helper the folding uses. The `/mcp` route
   declares its budget as `"message"`: the adapter spends the category the parsed message
   names (`messageRate`, a function of the method in the MCP service), so no adapter
   branches on the method and a body the protocol rejects spends the handshake budget too.

Verified by an integration test that storms `initialize` from one `User-Agent` past its
budget while a fresh client with another `User-Agent` completes `initialize`, `tools/list`
and `search` on the same key, and by the limiter unit test for every category's identity.
No setting was added; the maxima are constants like the other categories.

## Amendment 2026-09-11: the `GET`/`DELETE` /mcp 405 is answered by the route, not audited

Decision 1 folds every protocol rejection _inside a `POST`_ (an unsupported MCP method, a
malformed body) through the handshake window, because those are parsed JSON-RPC messages on
the authenticated transport. A `GET` or `DELETE` on `/mcp` is a different, pre-handshake
case: it is an unauthenticated HTTP-method probe of the optional standalone SSE stream and
session teardown that a stateless Streamable HTTP transport does not offer. 405 is the
compliant answer; there is no key, no `User-Agent` handshake identity, and no operation to
fold.

That 405 was throwing a `ServiceError` from the route into the generic app-level error
handler, whose `path === "/mcp"` arm wrote one `request.failure` row per probe with no
organization or key. On the hosted instance (2026-09-11) this was about 1,800 rows/hour
(5,068 since 18:00, user agent `node`): once-per-session for a well-behaved Streamable HTTP
client such as Claude Code, and constantly for the crash-looping Gemini Code Assist agent
of the main decision, each restart re-probing the stream. The rows are protocol plumbing
that scales with the number of clients and represent no operation an operator reads back.

The `GET`/`DELETE` `/mcp` route now answers 405 itself (`Allow: POST`, the same
`{code:"METHOD_NOT_ALLOWED", …}` body) instead of throwing, so it never reaches the audited
failure path and writes no row. This is option (a) of the same class as this ADR: a
capability probe is not a failed operation. Scope is strict — only the MCP endpoint's
unsupported-method probe changes. Every genuine 4xx/5xx on real API routes, every `POST
/mcp` failure (a missing bearer, a rejected body, an auth-store outage → 503), and the
handshake folding of decision 2 are all unchanged. Expected effect: the ~1,800
`request.failure` rows/hour from `GET /mcp` fall to zero, while a real Claude Code session's
`POST` handshake still folds and its `tools/call` rows are still one each.
