# 0012. SQL allowlisting is part of the security boundary

Date: 2026-09-07 · Status: accepted · Clarifies ADR 0004 and ADR 0010

A real PostgreSQL 16 experiment showed that ac_reader_user can change
statement_timeout with SET LOCAL, call set_config for a custom setting, and read
pg_catalog.pg_class. Direct base-table access and SET ROLE ac_app failed with 42501.
These are PostgreSQL privileges, not a defect that grants on public tables can fix.
Spec v3 incorrectly described the AST guard as only providing faster errors and the
reader role as independently forbidding all settings and catalog access.

Keep the two restricted reader roles, read-only transactions, security-barrier views,
invoker functions, and timeouts. Treat the pgsql-ast-parser relation/function allowlist
as a required boundary for caller SQL. It must reject configuration functions,
catalog-qualified names, role changes, nested forbidden statements, and alternatives
that bypass relation or function validation. Application-owned parameterized SQL sets
organization context at transaction start; it is never taken from caller SQL or body.

Tests separately prove the database guarantees and the AST guarantees. No test claims
that a PostgreSQL role alone blocks arbitrary user-settable configuration changes.
