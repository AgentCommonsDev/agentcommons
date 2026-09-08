# 0037. Structured search conditions

Status: accepted. Extends the explicit filter contract in §7.2.

Tool calls and their arguments need to be searchable without knowing every tool's exact
name or writing SQL. The existing typed MCP contract remains static; field values and
JSON argument paths refer to live organization data. A bounded AND list adds equality,
literal case-insensitive contains/prefix, and existence operations. Complex boolean
expressions, arbitrary regex and SQL expressions remain the SQL tool's job.

One shared schema defines the fields and operators. One parameterized predicate compiler
serves lexical search, vector eligibility, session lists and exports. Message predicates
bind the same message, not unrelated calls elsewhere in its session. JSON paths use the
full redacted stored input; the full-text prefix is not a correctness limit on filtering.
JSON primitive equality preserves types and distinguishes a missing path from JSON null.

The dashboard adds a small condition form alongside its existing chips. JSON-encoded GET
filters preserve parameter types and keys through query serialization. The MCP schema,
OpenAPI and client remain generated from the shared schema. R-SRCH-13 requires actual
Postgres, REST/MCP and browser verification, including tenant/privacy boundaries.
