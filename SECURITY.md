# Security policy

AgentCommons stores transcripts of coding-agent sessions, which can contain source
code, infrastructure details, and, despite redaction, occasionally secrets. Reports are
taken seriously and handled privately.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting for this repository (Security tab →
"Report a vulnerability"). This creates a private advisory visible only to maintainers.
Please do not open a public issue or discussion for a vulnerability. You will get an
acknowledgement within two business days and a fix or mitigation plan within fourteen.

## Scope

- The API server, dashboard, MCP endpoint, install script, hook shim, and pi extension
  in this repository.
- Redaction bypasses: a secret pattern that survives ingest is a security issue.
- Visibility bypasses: any path by which a user can read a private or purged session.
- SQL sandbox escapes: any statement other than a read against `api_ro`.

## Out of scope

- Vulnerabilities in the agent harnesses themselves (Claude Code, Codex, Gemini CLI, pi).
- Issues that require an already-compromised admin key.

## Secrets in this repository

GitHub secret scanning and push protection are enabled for this repository. API keys
issued by AgentCommons carry the `ac_` prefix so scanners can recognize them. Fixtures
are passed through the redactor in CI and must never contain live credentials.

## Design notes for reviewers

Visibility is enforced in database views keyed to the connected role, not in
application code. The SQL tool runs on a read-only role with statement timeouts and no
access to base tables. Redaction runs in memory before any write, and the server never
logs request bodies. See `docs/SPEC.md` §5.3 and §7.5.
