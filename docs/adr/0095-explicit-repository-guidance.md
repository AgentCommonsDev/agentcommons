# ADR 0095: Repository guidance requires an explicit command

Date: 2026-09-26
Status: accepted
Supersedes: ADR 0071

## Context

Writing instructions files during capture dirties a user's working tree. The next hook
then asks the agent to commit those files, which can add unsolicited changes to the user's
commit. The user requested removal of this automatic behavior.

## Decision

Remove the uploader's repository guidance writer, its decision files and configuration,
and the hook's guidance announcement. Legacy configuration and pending announcements have
no effect. Capture and upload never write repository instructions or stage or commit files.

Keep global installation instructions, recall hints and the explicit `hook.js guidance`
command. The command and `--off` operate only when invoked; they no longer maintain
per-repository decisions. The README and Install page describe guidance as optional.

## Consequences

Existing repository blocks remain in place until a person removes them, for example with
`hook.js guidance --repo <path> --off`. Automatic cleanup would itself modify the working
tree and could remove guidance a team chose to keep. New bundles reach installed hooks
through the existing self-update mechanism; older running bundles keep their behavior
until updated.
