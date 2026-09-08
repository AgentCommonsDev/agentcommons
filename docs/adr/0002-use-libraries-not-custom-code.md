# 0002. Use established libraries instead of custom implementations

Date: 2026-09-07 · Status: accepted

**Context.** Auth, secret detection, job queues, SQL parsing, and MCP transport are all
places where a small team can lose months and ship vulnerabilities.

**Decision.** Better Auth for users, roles, API keys, SSO, and email/password. secretlint for
secret detection. pg-boss for background jobs. pgsql-ast-parser for the SQL guard. The official
MCP TypeScript SDK. Prisma for the typed data layer. `@pulumi/awsx` for infrastructure.
Custom code is reserved for domain logic: normalizers, link detection, ranking, the hook shim.

**Alternatives.** Hand-rolled API keys and sessions; a regex list for secrets; Redis/SQS for
jobs; string checks for SQL safety. Each is less code today and more risk forever.

**Consequences.** Some behaviors are shaped by the library (Better Auth's key format and
permission model). The hook shim stays dependency-free by design, since it runs on every
developer machine.
