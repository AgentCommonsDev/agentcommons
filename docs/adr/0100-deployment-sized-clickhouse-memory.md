# ADR 0100: ClickHouse memory is sized per deployment

Date: 2026-10-29
Status: Accepted. Refines §7.5, Appendix B and ADR 0055; the defaults are unchanged.

## Context

Every reader principal ran with a fixed 256 MiB `max_memory_usage`, and the single-node
ClickHouse container had a fixed 3.5 GiB limit with a fixed 3 GiB server ceiling. Those
numbers were chosen for one 8 GiB `t4g.large`. The hosted instance was resized to a 16 GiB
`t4g.xlarge` on 2026-09-20 (commit 158bdc2), but nothing else could follow: ClickHouse still
used at most 3 GiB of the 16, and caller-authored `sql` that reads message content across
many sessions kept failing at 256 MiB. ADR 0096 explicitly left the reader limits unchanged.

Raising the constants would be wrong for every other single-node deployment: a 10 GiB
container or a 1 GiB query on the default 8 GiB host could exhaust the host or let a few
concurrent reads starve ingest.

## Decision

- `CLICKHOUSE_READER_MEMORY_MB` (default 256, 64 to 65,536) is part of the ClickHouse
  configuration. It renders `max_memory_usage` into every reader principal's settings,
  which are re-applied at each principal's first provisioning after an API start, so a
  change reaches existing principals without a migration.
- `CLICKHOUSE_MEMORY_LIMIT` (default `3.5G`) sizes the single-node ClickHouse container
  through Compose interpolation.
- The server ceiling is no longer a fixed byte count. `clickhouse-server.xml` keeps only
  `max_server_memory_usage_to_ram_ratio` at 0.88, and ClickHouse 26.8 measures that ratio
  against the container's cgroup limit (verified: a 3,500 MiB container logs "Changed setting
  'max_server_memory_usage' to 2.91 GiB (3.42 GiB available memory * 0.85…)" at 0.85).
  At the default 3.5G that keeps the ceiling at about 3 GiB, as before.
- Error messages say "the per-query memory limit" instead of quoting 256 MiB. The `sql`
  message points at `search_messages` and literal `session_id` values, the two ways to
  narrow the content reads that usually hit it.
- The read-path rule in `AGENTS.md` still measures every query at the 256 MiB default, so
  a larger host is headroom, not the budget new code is designed to.

## Consequences

- The hosted stack can set `CLICKHOUSE_MEMORY_LIMIT: 10G` and
  `CLICKHOUSE_READER_MEMORY_MB: "1024"` in its `environment` (about 8.2 GiB for the server,
  eight 1 GiB reads at once) and apply them with `pulumi up` and a release. Both settings
  must move together; the runbook says so.
- Other deployments see no change until they set either value.
- This is headroom, not the fix for searches failing at the limit: ADR 0098 makes search
  and ADR 0099 makes read attribution scale with their inputs rather than the corpus.

## Verification

`packages/traces/test/reader-memory.test.ts` covers the default, an override, rejected values
and the rendered principal settings. `infra/test/compose.test.ts` checks the default container
limit, a 10G override and the ratio-only server ceiling. The existing native-profile assertion
in `apps/api/test/read-memory.integration.test.ts` still finds 256 MiB on reader principals
under the default configuration.
