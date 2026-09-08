<img src="docs/assets/readme-logo.png" alt="AgentCommons logo" width="96" height="96">

# AgentCommons

Find your team's prior coding-agent work before repeating it.

AgentCommons keeps sessions from Claude Code, Codex, Gemini CLI, and pi searchable
in one place. Read an earlier debugging session, inspect tool output, and understand
why a teammate chose an approach. People and agents search the same history.

## Agent observability and governance

- **Find prior work.** Search prompts, decisions, and tool calls across your team's coding tools.
- **Follow the evidence.** Open the source session, its subagents, and the work that reused it.
- **See adoption.** Track captured sessions, search use, and reuse across the team.
- **Control access.** Manage organizations, members, and keys. Redact secrets before storage, add custom policies, and hide or purge sessions.

Your history stays with your team when you change tools or model vendors.
Versioned `AGENTS.md`, `CLAUDE.md`, and skills capture your instructions; session
history supplies the evidence behind them.

## Get your team started

1. Sign in and create or join your organization.
2. Open **Installation**, create a key, and copy the terminal command.
3. Start a coding session, then open **Sessions** to see it arrive.

Ask your agent: “Has anyone already worked on this problem?” It can search, open
source sessions, and query the shared history through MCP.

SaaS plans start with **1,000 captured records/month free**. **Pro is $100/month**
with 10,000 included records and configured usage charges; embeddings add
**$50/month** plus indexed-message usage. Enterprise teams can schedule a demo
when a calendar is configured. Operators can run this offering themselves; no
public hosted launch is implied.

## Run it for your team

Copy `.env.example` to `.env` and follow the [deployment guide](docs/customer-deployment.md)
to set the address and credentials. Then start the application and create an owner:

```bash
docker compose up -d --build
docker compose exec api pnpm db:seed --admin you@example.com --organization your-team --name "Your team"
```

Open the returned setup link and continue with **Installation**. Customer instances
keep public discovery disabled. Operators can enable hosted signup and billing with
`INSTANCE_MODE=saas`; see [environment settings](.env.example) for email, Stripe, and plans.

For local development, see [Contributing](CONTRIBUTING.md) and the
[configuration guide](docs/SPEC.md#appendix-b-configuration).

## Why shared history matters

[Claude Tag](https://support.claude.com/en/articles/15594475-what-is-claude-tag) and
[OpenTag](https://www.tryopentag.com/) bring shared context into chat.
[Shopify's River](https://shopify.engineering/under-the-river) leaves searchable
public Slack transcripts that teams use to improve skills and prompts.
AgentCommons applies that idea to coding work in terminals, IDEs, and CI, where
failed experiments and decisions often never reach a pull request.

Pre-release. See [verification](docs/VERIFICATION.md) for completed tests and live
capture checks. Threat detection and runtime tool-policy enforcement are future work.

[Spec](docs/SPEC.md) · [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md) · [Apache 2.0](LICENSE)
