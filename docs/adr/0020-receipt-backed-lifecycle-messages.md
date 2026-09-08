# 0020. Keep lifecycle message provenance in accepted receipts

Status: accepted, 2026-09-08.

Spec §12 requires a SYSTEM/META marker when an existing session resumes. A resume
can arrive without a new transcript record, and pi may resume a previously stored
branch. Giving this marker an invented native raw record or source offset would
misrepresent the harness transcript and complicate replay and rescans.

The canonical envelope carries optional `start: { resume: boolean }`, defaulting to
null for unknown/non-start events. Each native adapter maps its observed source or
reason value. Live captures establish `source: resume` for Claude Code, Codex and
Gemini CLI, and `reason: resume` for pi. Ordinary startup, fork, and unknown starts
do not imply a resume marker. The uploader coalesces duplicate native hook delivery
under its durable state lock; retries reuse the pending batch ID.

`IngestBatch.startResume` retains this explicit fact. The shared projection emits one
fixed `Session resumed.` SYSTEM/META message for each accepted resume receipt, with
UUIDv5 using the session namespace and `resume:<batch-id>:0` name. It is not searchable.
Native messages retain `rawRecordId`; a lifecycle marker instead carries
`ingestBatchId`. Composite foreign keys and a database check require exactly one
source, and receipt-backed rows must be non-searchable SYSTEM/META rows. No fabricated
RawRecord is created.

Order native messages by source position/block index as before. At each resume
receipt's observed watermark, place the marker after native messages at that position
and before higher positions. Multiple resumes at one watermark sort by source event
time, then stable marker ID. Late records can change dense sequence numbers without
changing message IDs. Batch replay and policy rescans reproduce the same projection.
A resume with a pending pi leaf uses the last successfully projected context until
the leaf arrives. Lifecycle authority still follows the existing source-order rule;
an old resume marker does not reopen a session ended by a newer event.
