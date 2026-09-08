# 0041. Session messages and repository links in the dashboard

Status: accepted. Extends the session-only tree in §10 after direct user review.

A list of related sessions does not let a person inspect the work performed by a
parent and its subagents. The Tree tab will present an expandable outline of the
captured session hierarchy. Each visible session expands to its ordered messages
and related sessions. Tool results nest under an unambiguous matching tool call by
its recorded tool-use ID. Other messages retain source order. The UI does not infer
which parent message spawned a child when that relationship was not captured.

The existing caller-visible tree and get services remain the source of data. The
browser loads a session's messages only when expanded and pages bounded responses;
it does not download entire transcripts to draw an outline. Every message links to
its transcript sequence. Hidden session gaps retain existing visibility rules and
never trigger a request for hidden messages. The current session is identifiable.

Repository, branch, start commit and end commit are visible above the transcript.
Recorded repository URLs become HTTPS links only after URL validation. GitHub,
GitLab and Bitbucket Cloud branch/commit URLs use one shared provider table and
encoded refs. Unsupported hosts retain a repository link and copyable metadata,
without guessing their commit routes. Missing repository or Git observations have
an explicit unavailable state. No branch or SHA is fabricated.

Validation covers parent/subagent/fork outlines, matched and unmatched tool results,
pagination, message deep links, privacy gaps, keyboard/touch expansion, narrow-screen
layout and host/ref URL safety. The live canary also reads each captured child through
REST/MCP and opens its own prompt and tool result in the dashboard.
