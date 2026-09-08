# 0031. Preserve lifecycle decisions and historical capture activity

Status: accepted, 2026-09-08.

Reconstructing lifecycle acceptance from source and receipt clocks lost the server's
decision when opposite events shared a native clock. Ordering equal receipt timestamps
by a client batch UUID could also reverse the actual transaction order. A later sync
then reopened a metrics activity window even though the session remained ended.

The ingestion transaction writes nullable `IngestBatch.lifecycleApplied` from its existing
`newerLifecycle` predicate. Every new receipt has an explicit boolean: true for an
applied start/end and false for sync or an ignored lifecycle event. The envelope has no
such field. Metrics consume this decision instead of recreating it. Null identifies
historical receipts; those retain the best available receipt-time/UUID reconstruction
with strict source-clock advancement. Historical ordering within the same millisecond
cannot be recovered and is not claimed as exact.

An active observation ends at the next accepted lifecycle transition in source order,
or after six hours without another observation. This keeps an older source-position
end from closing a newer resume when the native clock moves backward. Source timestamps
remain the activity clock; the system does not fabricate a replacement process clock.
Explicit native resume markers remain receipt facts independent of whether an old
receipt changed the current session status.

Historical coverage previously used the session's current last-activity timestamp.
Ingesting again after a selected interval removed that installation from past coverage.
The admin-only security-barrier `api_ro.metrics_activity` view now exposes visible
receipt timestamps and their installation IDs. Coverage counts distinct installations
with an accepted receipt in the selected interval's trailing seven days. Later receipts
cannot erase earlier activity; private/purged and organization boundaries still apply.

Independent real-Postgres regressions reproduced both failures before the fixes. Tests
also exercise actual ingestion decisions, equal server timestamps with reversed client
UUID order, native clock reversal, aggregate numerator/denominator consistency, and the
existing full metrics and ingestion suites. A valid pair of maximum bigint token
columns exposed a separate overflow before aggregation; the outcome view now widens
both operands to PostgreSQL numeric before adding them, preserving the existing stored
counter types and aggregate output contract.
