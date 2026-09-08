# 0008. No backfill of transcripts that predate installation

Date: 2026-09-07 · Status: accepted

**Context.** Both harnesses keep transcripts on disk, and both record repo and branch in them,
so a backfill could recover those. It cannot recover commits made, diff stats, or the device and
user at the time.

**Decision.** Do not build backfill. Capture starts at install. Near-real-time ingest (ADR 0005)
makes the live corpus fill quickly.

**Alternatives.** Backfill with `source=BACKFILL` and null git results (partial data that
complicates "what shipped" queries).

**Consequences.** Simpler shim and schema; historical sessions before install are not indexed.
