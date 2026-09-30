# ADR 0097: Retain unobserved child stops locally

Date: 2026-09-30
Status: accepted

## Context

A production audit found thousands of empty Claude child sessions. Five recent samples
had only one `SubagentStop` receipt, zero source watermark, no start receipt, and no raw
records. Their parents included a run with no `Agent` tool calls and runs containing both
normal transcript-bearing children and many empty child references. The parent harness
versions were 2.1.284 and 2.1.285. This establishes stop-only session creation without
transcript evidence; it does not establish that the corresponding transcripts were lost.

The uploader previously sent every child end immediately. Its fallback session start time
was the server's receipt time, so these empty children also appeared to end before they
started. The hook's existing, live-captured contract allows real child transcript writes
after the stop callback. Dropping a stop because its path is currently missing would lose
that legitimate late discovery.

An isolated 2.1.285 capture was attempted on 2026-09-30 but could not authenticate because
the local Claude OAuth session had expired. No new harness payload contract is asserted.
Regression tests replay the existing 2.1.265 stop fixture with missing, empty and delayed
local files. The rule below depends on observed source evidence, not a guessed agent type
or new hook field.

## Decision

In the shared uploader, retain a child's end intent locally when there is no start, no
acknowledged batch and no observed source watermark. Keep its event time, identity, source
snapshot and cursor unchanged. Do not create an empty remote session for that end alone.

On its first observation, check for source growth during the existing bounded settle
window. Subsequent parent drains do not repeat that wait for the same dormant child. A
later parent drain or the regular sweep resumes the ordinary pending-batch protocol when
bytes appear. A newer child observation can correct its path; the highest retained source
observation participates in discovery even before the earlier end is processed.

Dormant children neither take the sweep's one-session slot nor respawn uploaders. Existing
pending batches are still resent unchanged. An observed start, an earlier acknowledgment,
or positive source watermark keeps normal lifecycle delivery, including when previously
observed bytes have since disappeared from disk. No adapter-specific branch is added.

## Consequences

Stop-only callbacks without a transcript remain small local intent/state files instead of
empty indexed sessions. Late real transcripts remain recoverable while the disk survives;
there is no permanent timer or extra network retry loop. Historical server sessions are
unchanged because absence of indexed bytes alone is insufficient evidence to delete them.
