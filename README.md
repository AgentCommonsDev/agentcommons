# AgentCommons

Shared session history for coding agents and the people working with them.

AgentCommons makes prior work searchable across your team's coding tools. Before
starting another investigation, an agent can find what was tried, what failed, and
why a decision was made. The history stays with your team when you change vendors.

Pre-release. See [verification](docs/VERIFICATION.md) for the test suites and live checks.

## Why it exists

[Claude Tag](https://support.claude.com/en/articles/15594475-what-is-claude-tag)
helps teams coordinate with Claude using shared Slack context.
[OpenTag](https://www.tryopentag.com/) offers a model-agnostic coworker in chat.
Developers also work in terminals, IDEs, and CI. Failed experiments and decisions
made there often never reach Slack or a pull request, so the next agent repeats them.

AgentCommons captures that work at its source. Agents search it through MCP;
people browse the same sessions in a dashboard. Teams can coordinate across coding
tools without moving every task into chat or tying their history to one provider.

Versioned `CLAUDE.md`, `AGENTS.md`, and skills record how your team works. Session
history supplies the evidence behind those instructions and keeps new decisions
available to the next person or agent.

## What you get

- Transcripts and tool output, with subagent and fork relationships.
- Three MCP tools: `search` for prior work, `get` for a session, and `sql` for counts
  and joins over read-only views.
- A dashboard for search, transcripts, reuse metrics, and organization administration.
- Separate organization data, permissions, and API keys. Admins add people by email
  for SSO or password access.
- Secret redaction before server storage, audit records, and controls to hide or
  purge sessions. Local transcripts and upload spools can still contain secrets.

The server runs as one application container with Postgres. A local hook records
capture intent and starts a detached uploader, keeping network waits out of the
agent's session. Semantic ranking is disabled by default.

## Self-hosting

Clone the repository and copy `.env.example` to `.env`. Set `PUBLIC_URL` to the
address people will use, such as `http://localhost:3000`. Change the host in all
four database URLs to `db`, choose new database passwords, and set
`BETTER_AUTH_SECRET` with `openssl rand -hex 32`. The migration URL's password must
match `POSTGRES_PASSWORD`; migration creates the other database accounts.

```bash
docker compose up -d --build
docker compose exec api pnpm db:seed --admin you@example.com --organization your-team --name "Your team"
```

Open the returned setup link to choose your password, then sign in. Owners add
members by email and share initial password setup links directly. SSO users sign
in through the configured identity provider. Repeat the seed command with another
organization slug to create a separate organization.

Compose binds port 3000 to localhost. Put an HTTPS reverse proxy in front of it for
remote access and configure `TRUST_PROXY` for that proxy. Customer instances block
search indexing by default; set `INSTANCE_MODE=public` to publish the landing page
and discovery files. See [configuration](docs/SPEC.md#appendix-b-configuration) and
[verification](docs/VERIFICATION.md) for the remaining settings and checks.

## Development setup

Develop with Node.js 22.12+ and pnpm 10.

```bash
git clone https://github.com/rek7/agentcommons && cd agentcommons
cp .env.example .env
# Set a new BETTER_AUTH_SECRET and review the database URLs in .env.
pnpm install
docker compose -f docker-compose.dev.yml up -d
pnpm db:migrate
pnpm db:seed --admin you@example.com
pnpm dev
```

Open the dashboard at `http://localhost:5173`; the API listens on port 3000.
Keep `PUBLIC_URL=http://localhost:5173` for this development setup so login and
browser write requests use the same origin. A bundled server serves the dashboard
on port 3000; set `PUBLIC_URL` to its externally reachable origin. See [the spec](docs/SPEC.md) for
configuration and [contributing](CONTRIBUTING.md) for verification requirements.

Once the server is running, create an organization API key with ingest and read
permissions and connect a machine with Node.js 20+ and curl:

```bash
curl -fsSL https://your-host/install.sh | sh -s -- --key ac_…
```

The installer configures capture and MCP. Codex requires interactive hook trust.
Then ask your agent: “Has anyone already worked on rate limiting here?”

## Capture support

Capture supports Claude Code, Codex, Gemini CLI, and pi. The
[live checks](docs/VERIFICATION.md#live-provider-checks) run each tool through
capture, dashboard display, and retrieval by another agent. See the
[capture report](docs/harness-capture-2026-09-07.md) for observed behavior.

## Future work

We plan to add agent observability, threat detection, and policy controls so admins
can investigate suspicious behavior and govern tool use and data access.

[Spec](docs/SPEC.md) · [Requirements](docs/REQUIREMENTS.md) · [Decisions](docs/adr/) ·
[Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Apache 2.0](LICENSE)
