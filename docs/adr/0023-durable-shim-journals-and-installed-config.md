# 0023. Publish hook intents independently of upload acknowledgments

Status: accepted, 2026-09-08.

A hook can run while its detached uploader awaits a response. Having both processes
rewrite one state object can lose either the new lifecycle event or the acknowledged
cursor. Each callback therefore publishes an immutable intent beside the session state;
the uploader alone updates that state. Pending bytes and their batch ID are persisted
before sending, and the cursor advances only after 202. Split continuations remain unsent
material behind the single pending batch. Rejected records are retained before pending
is rewritten; oversized records retain their original bytes locally.

Exclusive publication prepares and fsyncs a private file, atomically links it into place,
and fsyncs the containing directory. A killed publisher cannot leave an empty owner file.
Locks bind PID to process birth identity and a random token. Stale cleanup serializes on
that token and rechecks ownership before unlinking, including after terminating an owner
that exceeded the five-minute lifetime. Native callbacks never acquire this upload lock.

Lifecycle intent identity includes the owning native process PID/birth and preceding
start/end phase. Live duplicate Codex callbacks had distinct child PIDs but one native
owner identity. This coalesces duplicate configuration delivery while preserving a later
empty resume. Lifecycle receipts retain their hook-time source watermark; reading newer
raw bytes never promotes a delayed end event to that newer position.

The installer uses verified Codex 0.153.4 inline user TOML, not an assumption that modern
project hook discovery matches 0.150. Unique user profile files provided a reversible live
experiment without changing existing credentials or global configuration. A second
experiment temporarily installed the user TOML hooks and restored the original file
byte-for-byte. Native stdin payloads are retained under fixtures/hooks.

Doctor binds configuration to the organization returned by `/me`. State pins the original
server, organization, and verified credential fingerprint. Rotation verifies the new key
before sending an old spool; another organization's key cannot migrate that source.
AGENTCOMMONS_DIR and installer `--config-home` isolate canary data/settings without changing
HOME or CODEX_HOME. Installer ownership records preserve displaced MCP entries and avoid
removing later user edits on uninstall. Native MCP CLIs are used for ordinary user
installation; an explicit isolated settings root uses the equivalent captured config.

The hook bundles Zod and other build dependencies into one Node 20-compatible file with
no runtime package dependencies. Namespace imports allow unused Zod exports to be removed,
and upload/install modules initialize only in their respective modes. The installed
directory declares CommonJS so Node 20 does not depend on newer syntax detection.

Validation includes real SIGKILL at persisted/accepted/acknowledged boundaries, all-event
hook timing with blocked hook-process networking, source-version and partial-tail tests,
HTTP rejection classes, subtree/sweep behavior, and checksum/idempotence/offline uninstall.

Outage profiling found that parsing 1000 queued intent files took 207 ms. Immutable journal
filenames now index watermark/event time/kind/id. Hook mode lists those names and reads
only the selected source/start/end payloads; the uploader alone parses the full queue.
Missing files removed by a concurrent acknowledgment are tolerated. The strict 150 ms
performance suite includes 5000 pending indexed intents and runs serially after heavy
verification jobs; the threshold is unchanged.

The pi bridge assigns a shared observation id and increasing timestamp to each native
event object in a WeakMap shared across duplicate extension instances. These are bridge
metadata, not invented native transcript records. Repeated observers share the same id;
distinct empty resumes remain distinct even if detached callbacks arrive out of order.
An actual hook-to-HTTP-to-Postgres regression also found that drain-time timestamps could
make a delayed older pi tree event replace a newer branch. State now retains the newest
native context time, refuses older context/path replacements, and uses that time on
source syncs and deferred replay. Tests cover both an unchanged source watermark and
new raw bytes observed by the delayed callback. Lifecycle receipts keep their original
event time independently.
Claude MCP registration was also verified with the real native CLI in an isolated
CLAUDE_CONFIG_DIR: user MCP entries are stored in `.claude.json` separately from settings.json.

An independent kill-point review found that clearing pending before deleting its file
left acknowledged plaintext behind when killed between those steps. The acknowledgment
now persists a bounded cleanup list of consumed paths and processed intent IDs. The
owner finishes that list idempotently before any later sends and clears it only after
deleting the files. Actual SIGKILL tests assert both spool and journal cleanup after
restart, including the post-acknowledgment checkpoint. Unsent split files stay retained.
Installer review also verifies unowned empty hook groups survive both installation and
uninstallation; only groups from which marked entries were removed may be dropped.
