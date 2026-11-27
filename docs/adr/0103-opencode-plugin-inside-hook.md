# ADR 0103: opencode is captured by a plugin that hook.js carries

Status: accepted

## Context

opencode has no shell hooks and no transcript file: sessions live in SQLite. Two engine
lines are current: 1.x (npm `opencode-ai`) and 2.x (the desktop app's engine, npm
`@opencode/cli`). Their plugin interfaces and stored message shapes differ, and 2.x
rejects 1.x plugins. Both load every file in `~/.config/opencode/plugin/`. The desktop
app puts no `opencode` command on PATH.

pi, the other harness without shell hooks, is captured by an extension delivered as a
second artifact named in the hook manifest. A new manifest field would break the strict
manifest readers still installed (ADR 0075).

## Decision

One plugin file serves both interfaces: a default export with `id`, `setup` (2.x) and
`server` (1.x). It reads each session through opencode's own plugin API and keeps one
JSON document per session, merged by message id, then runs `hook.js opencode`, so the
existing `json-document` reader and upload path apply unchanged. A child session's events
are sent on its parent and name the child, reusing child-source registration and the
SUBAGENT parent hint. The plugin also adds the §8.3 guidance to the system prompt and
enforces the cached tool policy, as the pi extension does.

The plugin is bundled into `hook.js` as text at build time, and `hook.js install` writes
it into opencode's plugin folder. Self-update re-runs the installer, so a new plugin
reaches machines with no manifest change. The installer treats `~/.config/opencode` as
evidence that opencode is installed, through a `presence` list on the `HARNESSES` entry.

The normalizer reads each record's shape, never the engine version, so one document may
hold either shape and a later version that keeps a shape needs no change. Records of an
unknown shape stay raw-only, like every other harness's unknown records, and can be
projected after a normalizer update by a rescan.

## Consequences

- opencode support needs a server release before any machine sends `OPENCODE`; older
  servers answer 400 for the unknown harness.
- The Postgres `Harness` enum gains `OPENCODE`; an image rollback does not remove it.
- `hook.js` grows by the plugin bundle (about 11 KB).
- opencode is not yet in the live canary, so support is not announced (§3.1).
