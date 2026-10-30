# ADR 0105: The API's memory is sized per deployment

Date: 2026-10-30
Status: Accepted. Extends ADR 0100 to the API container; the default is unchanged.

## Context

The single-node API container had a fixed 1 GiB limit and a fixed 768 MiB V8 heap. The
API process also runs the trace-projection worker, and publishing a session rebuilds its
projection from every raw record the session has published, plus up to 100 reserved
outbox batches. The worker's heap therefore grows with the largest session being
published, not with the batch.

On 2026-10-30 the hosted instance held sessions with more than 300 MiB of raw records.
Each publish of one of them exhausted the heap about 80 seconds after the API started, so
the API restarted 166 times in about four hours and answered 502 between restarts. Raised
to a 5 GiB container on the host, the same publishes peaked at 2.8 GiB.

## Decision

- `API_MEMORY_LIMIT` (default `1G`) sizes the single-node API container through Compose
  interpolation, as `CLICKHOUSE_MEMORY_LIMIT` does for ClickHouse.
- The heap is set from the container as `--max-old-space-size-percentage=75`, which Node
  24 measures against the cgroup limit. A heap larger than the container cannot be
  configured, and one setting moves both.
- On the hosted 16 GiB `t4g.xlarge`, whose PostgreSQL is external, set
  `API_MEMORY_LIMIT: 5G`, `CLICKHOUSE_MEMORY_LIMIT: 7G` and
  `CLICKHOUSE_READER_MEMORY_MB: "1024"`. This replaces ADR 0100's 10G ClickHouse example,
  which left the API no room on that host.

## Consequences

- Other deployments see no change until they set the value.
- This is headroom, not a bound. Publish memory still scales with the session, so a
  large enough session exceeds any limit. Bounding it requires publishing a session
  incrementally instead of rebuilding it. That is a separate change.
- A deployment's values live in its stack `environment`. A value set only in a host's
  `.env` lasts until the next release re-renders that file.

## Verification

`infra/test/compose.test.ts` checks the default container limit, a 5G override and the
percentage heap flag.
