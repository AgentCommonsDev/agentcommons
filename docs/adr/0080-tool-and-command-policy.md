# ADR 0080: Tool and command policy, enforced by the shim and recorded from sessions

Date: 2026-09-14
Status: Accepted. Adds §9.7; builds on the redaction-rules-as-data model (§5.3) and the
captured pre-tool hook contracts (Appendix A).

## Context

AgentCommons already sees every tool call every agent makes across an organization, but it
had no way to say which calls are allowed. Teams asked for governance over agent behaviour:
stop an agent running a destructive command, flag risky ones, and review what agents did.
The captured hook contracts (Appendix A, 2026-09-14) proved that all four supported
harnesses can veto a tool call before it runs: Claude Code, Codex and Gemini CLI honour a
pre-tool hook that denies with `{"decision":"block","reason":R}` and exit 0, and pi's
extension denies by returning `{block:true,reason:R}`. The three shell-hook harnesses fail
open, letting the tool run when the hook is slow, crashes, or exits non-zero, and no
post-tool event fires for a blocked call.

## Decision

1. **Rules as data, one implementation.** A `ToolPolicy` is organization-scoped: an
   `enabled` flag and an ordered list of rules (harness or any, tool glob, optional command
   patterns, action `deny`/`warn`/`allow`, severity). `evaluateToolCall` in
   `packages/core/policy` is a pure function used by both the shim and the server; harness
   differences are data, never a code path. Ordering is first-match-wins, so an explicit
   `allow` above a broad `deny` whitelists a call. No match, or a disabled policy, allows.
2. **Enforcement is a local decision in the shim.** Because the shell harnesses fail open,
   the decision must be fast and offline: the pre-tool hook reads the policy synced to the
   machine and returns the harness-specific deny/warn/allow shape from Appendix A. It never
   makes a network call on the hook path, and it emits the blocked telemetry itself since no
   later event fires for a blocked call. pi fails closed, which is acceptable for a deny.
3. **Detection independent of enforcement.** The server evaluates captured sessions' tool
   calls and records violations even when enforcement is off, so an organization can see
   what a policy would catch before turning it on. A violation stores a masked preview and
   salted fingerprint of the command, never the raw command, reusing the redaction
   preview/fingerprint of §5.3, so a flagged command containing a secret is not re-persisted.
4. **A default preset, shipped disabled.** AgentCommons ships high-value guardrails
   (recursive force-delete, piping a download into a shell, force-push to a protected
   branch, reading or writing credential and system files, disabling safety guards), but a
   fresh organization's policy is `enabled: false` and enforces nothing until an admin turns
   it on. Disabled-by-default is a tested invariant.

## Consequences

Governance over agent actions with no change for organizations that do not opt in. The
enforcement decision cannot depend on the network, which the fail-open reality of the shell
harnesses requires. A very short command reveals nothing in its masked preview, the same
residual the redaction preview documents. User-supplied command regexes are safety-checked
at creation on the server with the same ReDoS analysis redaction rules use; the shipped
preset patterns are hand-vetted and bounded, and the matcher scans a bounded command
length so a pattern cannot be made to run long. Requirements R-POL-01 through R-POL-03.
