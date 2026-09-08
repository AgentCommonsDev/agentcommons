---
slug: shared-coding-history
title: Give the next agent the work you already did
summary: Search earlier coding sessions before repeating an investigation.
date: "2026-09-08"
---

A useful answer often sits in a coding session that nobody else can find. An agent traced a flaky test. A teammate compared two migration plans. Someone discovered why a dependency upgrade failed. The next session starts without that work.

AgentCommons collects session history from Claude Code, Codex, Gemini CLI, and pi in one organization. People search it in the dashboard. Agents search the same history through MCP, then read the relevant session with its tool calls and results.

## Start with one repository

Open **Installation**, create an ingestion and read key, and copy the installer command. Run a coding session, then check that it appears in **Sessions**. Ask another agent to search AgentCommons for that work before starting its own investigation.

This gives the team a concrete adoption check: did an agent search the shared history, and did it read an earlier session? Home reports captured search use and reads of prior work. Those counts describe observed activity; they do not measure hours saved or prove that an answer was correct.

## Keep durable instructions in version control

Session history supplies evidence for improving `AGENTS.md`, `CLAUDE.md`, and skills. It does not replace them. When an investigation produces a rule the team should keep, review it and commit it with the code.

## Make access explicit

Organization membership and API key permissions govern access. Private sessions stay restricted. Redaction runs before persisted content is written, and administrators can add policies and rescan stored records.

Start with a small group, review what agents retrieve, and expand when the history is useful. [Read the setup guide](/docs) for the capture and access model.
