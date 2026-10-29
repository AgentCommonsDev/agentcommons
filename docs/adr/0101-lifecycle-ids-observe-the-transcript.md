# ADR 0101: Lifecycle intent ids observe the transcript; a batch conflict is no verdict

Date: 2026-10-29
Status: accepted

## Context

A lifecycle intent's id hashed the harness, session, launch identity, event name and
preceding phase, and its batch id is the UUIDv5 of that id (§6.2). `preceding` repeats
while the phase kind repeats, so every start in one phase of one process hashed alike.
Claude Code runs `SessionStart` again at each auto-compaction, from the same process and
with no end in between (2.1.309, Appendix A), so the compaction start reused the startup's
intent id and batch id.

The uploader skips an id it still holds in `processed` (the last 512), so in a short
session the compaction start was dropped and its journal file stayed behind. In a long
session the startup's id had left `processed` by the first compaction: the uploader sent
the start under the startup's batch id at a later cursor, the server answered `409
BATCH_CONFLICT` (§5.1), and the shim, which read every 409 as the server's verdict on the
session, suspended it for good. Nothing after the first compaction of a long session
reached the server. A skipped duplicate that surfaces hours later, once its id leaves
`processed`, ends the same way. A maintainer's machine showed such suspensions from
2026-10-08 on: states parked on the 409 with the compaction start pending and up to a
thousand intents journaled behind it.

## Decision

The lifecycle intent id also covers the signature of the transcript its callback observed
(device, inode, size and modification time; sync intents already carry it). Duplicate
callbacks of one event run before the harness writes on and observe the same file, so they
still coalesce under one id (ADR 0020). A later start in the same phase observes a grown
transcript and gets its own id, batch id and receipt. The signature, not the watermark: a
mutable document's watermark depends on which journal entries the hook read, the signature
only on the file. pi's bridge ids (`event_id`) are unchanged.

A 409 still suspends, now with its error code in the reason, except `BATCH_CONFLICT` on a
lifecycle batch. A lifecycle batch id derives from its intent id, which names the event,
so the server already holds that event's receipt at another cursor: the intent completes
as processed and its journal files are removed, while `ackedCursor` and the source snapshot
stay where they are. Source, deferred and split batches carry random ids and cannot
conflict; a conflict there means something else is wrong and suspends like any 409.

Earlier bundles recorded every ingest 409 as `{ code: 409, reason: "The server rejected
this session." }`, without its code. Reading such a state lifts that suspension: the
session's own uploader, or for an ended session the sweep of any other session's
uploader, resends its pending batch. A conflicting compaction start completes and the
journal drains from the unchanged acked cursor. A genuine `SESSION_OWNED` or
`SESSION_PURGED` suspends it again under a reason naming the code, which is never lifted.
Suspensions the shim decides itself (server, organization or credential changes) carry
other reasons and stay.

## Consequences

Each compaction adds a start receipt with `startResume` false, so no resume marker. A
recovered session loses only the receipt of the start that conflicted, never a transcript
record. After the update each installation sends one request per session an earlier
bundle suspended; those with a genuine verdict stay suspended after it.

A callback that observes the transcript after the harness wrote to it is a new event. Live
captures show duplicate callbacks (Codex with user and project `hooks.json`, Gemini's
`SessionEnd`) firing together; if a harness ever wrote between two callbacks of one resume,
the second would add its own resume marker.
