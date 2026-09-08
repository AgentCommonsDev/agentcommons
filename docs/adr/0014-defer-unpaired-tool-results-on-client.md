# 0014. Defer unpaired results on the client

Date: 2026-09-07 · Status: accepted · Clarifies the fail-closed pairing requirement

The original spec required both withholding an unpaired tool result and completing it
when its input arrived later. The original content cannot be recovered from a
server-side placeholder. Keeping a hidden raw copy would defeat sensitive-file
redaction and expose it through raw records or backups.

Use the existing 422/quarantine mechanism. An unpaired result rejects its entire batch
before persistence with the named record and UNPAIRED_TOOL_RESULT code. The uploader
durably retains it locally, resends other records, and retries deferred results once
after each subsequent acknowledged source batch. A failed replay remains deferred;
permanent invalid records remain quarantined. Every resend uses the one pending-batch
state machine. Raw result mirrors are identified by adapters and replaced by one
shared patcher when a sensitive input is known.

This changes the location of withheld data to the originating machine. Integration
and kill-point tests must prove that a deferred result survives cursor advancement,
and no unpaired raw result reaches server storage.
