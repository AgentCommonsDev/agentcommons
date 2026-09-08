# 0015. Use supported profiling control in secretlint 13

Date: 2026-09-07 · Status: accepted

Real Postgres ingest of the captured transcripts exposed a process-wide profiling
cost in secretlint 10.2.2. A V8 CPU profile attributed over 85% of samples to its
PerformanceObserver callback. Each lint call retained timing entries, and the callback
searched the growing entry array for every end mark. Recursive JSON redaction made
the cost accumulate over otherwise small batches.

Secretlint 13.0.5 provides the supported `secretLintProfiler.setEnabled(false)` API.
Use it in the shared redactor. Upgrade core, pattern, preset, and profiler together;
keep all scanner behavior under regression tests. No library fork, monkey patch,
custom secret scanner, or per-request child process is needed.

The server and repository development now require Node 22.12 or newer, meeting the
Secretlint and Vite engine requirements. CI and containers already use Node 24. The separate,
zero-dependency installed hook continues to support Node 20.

Upstream documentation:
https://github.com/secretlint/secretlint/blob/master/packages/@secretlint/profiler/README.md
