<p align="center">
  <img src="docs/assets/readme-logo.png" alt="AgentCommons logo" width="120" height="120">
</p>

<h1 align="center">AgentCommons</h1>

<p align="center">Shared history, governance, and observability for your team's coding agents.</p>

<p align="center">
  <a href="#get-your-team-started">Install</a> ·
  <a href="docs/README.md">Docs</a>
</p>

<p align="center">
  <a href="https://github.com/AgentCommonsDev/agentcommons/actions/workflows/ci.yml"><img src="https://github.com/AgentCommonsDev/agentcommons/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="https://github.com/AgentCommonsDev/agentcommons/actions/workflows/installer.yml"><img src="https://github.com/AgentCommonsDev/agentcommons/actions/workflows/installer.yml/badge.svg" alt="Installer platforms status"></a>
  <a href="https://github.com/AgentCommonsDev/agentcommons/actions/workflows/live-canary.yml"><img src="https://github.com/AgentCommonsDev/agentcommons/actions/workflows/live-canary.yml/badge.svg" alt="Live harness canary status"></a>
</p>

AgentCommons keeps sessions from Claude Code, Codex, Gemini CLI, and pi searchable
in one place. People and agents search the same history, so nobody repeats an
investigation. Dashboards and SQL show what every agent did. Redaction, visibility,
purge, and audit rules apply once across the organization. Teams and their agents get
more effective because nobody repeats work, leaders see what agents are doing, and
admins enforce controls once for everyone.

## See it

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/home-dark.png">
  <img src="docs/assets/screenshots/home-light.png" alt="The Team overview dashboard seen by an admin: captured sessions, sessions that searched, sessions reusing prior work and the reuse rate as stat tiles, a weekly reuse rate chart, a donut of sessions by coding tool, sessions per day and the most active repositories." width="100%">
</picture>

<p align="center"><sub><b>Home, as an admin.</b> The organization's default dashboard. Every tile is a SQL query over the captured sessions, and members can add their own dashboards.</sub></p>

<table>
  <tr>
    <td width="50%" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/sessions-dark.png">
        <img src="docs/assets/screenshots/sessions-light.png" alt="The Sessions list seen by an admin: full-text search over messages, filters, a count of matching sessions and messages, one row per captured session with its title, coding tool, repository and branch, user, start time, message count and status, and the Organization admin section in the sidebar." width="100%">
      </picture>
      <p align="center"><sub><b>Sessions, as an admin.</b> Search prompts, decisions and tool output across every coding tool, or browse each captured session. Admins also see the Organization section: people, keys, audit log, moderation, redaction, status and settings.</sub></p>
    </td>
    <td width="50%" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/session-dark.png">
        <img src="docs/assets/screenshots/session-light.png" alt="One session page: header with coding tool, model, user and repository, a Download CSV action, the sessions that reused it, and the transcript with a subagent run expanded inline under the Agent call that spawned it." width="100%">
      </picture>
      <p align="center"><sub><b>Session, as a member.</b> The transcript with thinking, tool calls and a subagent run nested under the call that spawned it. The header lists later sessions that read this one.</sub></p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/sql-dark.png">
        <img src="docs/assets/screenshots/sql-light.png" alt="The SQL page: a schema explorer of read-only views, an editor with a query grouping sessions by repository and coding tool, and the result table." width="100%">
      </picture>
      <p align="center"><sub><b>SQL, as a member.</b> ClickHouse SQL over read-only views of sessions, messages, files and tools, with completions and a schema briefing your assistant can use.</sub></p>
    </td>
    <td width="50%" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/install-dark.png">
        <img src="docs/assets/screenshots/install-light.png" alt="The Install page: a form to create a key for a machine, a picker for an existing key, per-tool notes, and the one-line install command with the key masked." width="100%">
      </picture>
      <p align="center"><sub><b>Install, as a member.</b> Create a key for the machine and run one command. It installs the capture hook for every coding tool and connects the agents over MCP.</sub></p>
    </td>
  </tr>
</table>

## History, governance, and observability

- **Find prior work.** Search prompts, decisions, and tool calls across Claude Code, Codex, Gemini CLI, and pi sessions. Agents search through MCP; people search in the app.
- **Follow the evidence.** Open the source session, its subagent runs, and the later sessions that read it.
- **See what agents do.** Home is your organization's default dashboard, and you can add more in the visual editor or through MCP. The SQL page queries every session with completions, live diagnostics, and a schema briefing you can copy for your assistant.
- **Control access.** Manage members, keys, and Google sign-in domains. Redact secrets before storage, add custom policies, hide or purge sessions, review the audit log, and check each machine's hook status.

Your history stays with your team when you change tools or model vendors.
Versioned `AGENTS.md`, `CLAUDE.md`, and skills capture your instructions; session
history supplies the evidence behind them.

## Get your team started

1. Sign in and create or join your organization. A new organization needs only a name.
2. Open **Install**. Create a key for your machine and copy the command. Run it in a
   terminal with Node.js 20 or newer; it installs the capture hook for every coding tool
   on that machine. Codex asks you to trust the hooks once. Installed hooks update
   themselves within an hour of a server upgrade, so re-run the installer only on a new
   machine or for a new key.
3. Start a coding session. It appears on the Install page within seconds and stays under
   **Sessions**. **Home** shows captured sessions, search use, reuse, and the charts your
   team adds.
4. Ask your agent: “Has anyone already worked on this problem?” The installer also
   connects Claude Code, Codex, and Gemini CLI on that machine to AgentCommons over MCP
   with the same key, so the agent can search before it starts. It can search, open
   source sessions, run SQL, and save dashboards. pi reaches the same tools through its
   AgentCommons extension.

If the installer did not detect a tool, or a machine has no hook, add the server by hand:

```bash
claude mcp add -s user -t http agentcommons https://your-server/mcp -H "Authorization: Bearer <key>"
codex mcp add agentcommons --url https://your-server/mcp --bearer-token-env-var AGENTCOMMONS_API_KEY
```

Gemini CLI takes an `mcpServers` entry in its settings. **API reference** in the app
documents the same REST routes.

Codex needs no trust prompt for MCP servers. The one-time trust prompt covers hooks only.
In scripts, run `codex exec` with stdin closed (`codex exec "…" < /dev/null`), or it waits
on "Reading additional input from stdin…" until the timeout. Verified on 2026-09-10 with
Codex 0.153.4 and Claude Code 2.1.266 against a hosted instance.

SaaS plans start with **1,000 captured records/month free**. **Pro is $100/month**
with 10,000 included records and configured usage charges; embeddings add
**$50/month** plus indexed-message usage. Enterprise teams can schedule a demo
when a calendar is configured. Operators can run this offering themselves; no
public hosted launch is implied.

## Run it for your team

Clone the repository, copy `.env.example` to `.env`, set `PUBLIC_URL`, the PostgreSQL and
ClickHouse passwords, and `BETTER_AUTH_SECRET`, and point the database URLs at host `db`
as the comments describe. Then start the published image and create an owner:

```bash
docker compose pull
docker compose up -d
docker compose exec api pnpm db:seed --admin you@example.com --organization your-team --name "Your team"
```

The seed prints a setup link. Open it, set your password, and continue with **Install**.
For HTTPS on one host, add `docker-compose.caddy.yml` (set
`COMPOSE_FILE=docker-compose.yml:docker-compose.caddy.yml` in `.env`): Caddy obtains the
certificate for `PUBLIC_URL` and proxies to the API.

Every commit on `main` that passes CI is published as
`ghcr.io/agentcommonsdev/agentcommons:stable` for amd64 and arm64, signed with Sigstore.
Install the updater once so the host picks releases up on its own; it checks hourly,
migrates the databases, restarts the API, and puts the previous image back if the new one
does not become ready:

```bash
sudo install -m 0755 scripts/self-host/agentcommons-update.sh /opt/agentcommons/agentcommons-update.sh
sudo install -m 0644 scripts/self-host/systemd/agentcommons-update.* /etc/systemd/system/
sudo systemctl enable --now agentcommons-update.timer
```

The unit expects the checkout at `/opt/agentcommons/app`; change `AGENTCOMMONS_APP_DIR`
with `systemctl edit agentcommons-update.service` if yours lives elsewhere. Set
`AUTO_UPDATE=false` in `.env` to stop automatic updates at any time, and run
`agentcommons-update.sh --now` to update by hand or `--status` to see the running version.
To stay on one release, set `AGENTCOMMONS_IMAGE` to its `sha-` tag, shown on Admin →
Status, and run `docker compose up -d`.
To run PostgreSQL elsewhere (a managed service, another host), set
`AGENTCOMMONS_DATABASE=external`, add `docker-compose.external-database.yml` to
`COMPOSE_FILE`, and point the three database URLs at that server;
`scripts/self-host/migrate-database.sh copy` moves an existing bundled database there and
`verify` compares the row counts. On AWS the `database` stack setting in `infra/` provisions
Aurora PostgreSQL Serverless v2 for the single-node deployment; see
[infra/OPERATIONS.md](infra/OPERATIONS.md).
Customer instances keep public discovery disabled. Operators can enable hosted signup
and billing with `INSTANCE_MODE=saas`; see [environment settings](.env.example) for
email, Stripe, and plans. AWS deployment uses Pulumi from `infra/`.

For local development, see [Contributing](CONTRIBUTING.md) and the
[configuration guide](docs/SPEC.md#appendix-b-configuration).

## Why shared history matters

[Claude Tag](https://support.claude.com/en/articles/15594475-what-is-claude-tag) and
[OpenTag](https://www.tryopentag.com/) bring shared context into chat.
[Shopify's River](https://shopify.engineering/under-the-river) leaves searchable
public Slack transcripts that teams use to improve skills and prompts.
AgentCommons applies that idea to coding work in terminals, IDEs, and CI, where
failed experiments and decisions often never reach a pull request. It works the same
across Claude Code, Codex, Gemini CLI, and pi, and with any tool that can call MCP or
REST, so a team can change chat apps or agent harnesses and keep its history.

Pre-release. See [verification](docs/VERIFICATION.md) for completed tests and live
capture checks. AgentCommons records and indexes sessions. It does not block tool
calls or detect suspicious behavior.

[Spec](docs/SPEC.md) · [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md) · [Apache 2.0](LICENSE)
