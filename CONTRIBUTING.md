# Contributing

Thanks for helping build AgentCommons.

## Before you start

- Read `docs/SPEC.md`. This project is spec-first: behavior changes begin as a spec
  change (and an ADR in `docs/adr/` if a decision changes), then code.
- Read `AGENTS.md` for layout, rules, and commands. It is written for agents and humans;
  `CLAUDE.md` and `GEMINI.md` are symlinks to it.

## Development

```
pnpm install
docker compose -f docker-compose.dev.yml up -d
pnpm db:migrate && pnpm db:seed --admin you@example.com
pnpm dev
```

Run `pnpm test`, `pnpm lint`, and `pnpm typecheck` before opening a PR. Integration
tests need Docker (testcontainers).

## Pull requests

- One concern per PR. Link the spec section you are implementing or changing.
- Include tests that cite requirement IDs from `docs/REQUIREMENTS.md`. Run
  `pnpm spec:check` and the verification suites required by spec §16.
- If you touch routes, commit the regenerated OpenAPI document.
- If you touch the hook contract, re-capture fixtures rather than editing them.
- Never commit secrets or unredacted transcripts.

## Reporting bugs

Open an issue with the harness and version (`claude --version`, `codex --version`),
the server version, and the relevant lines from `~/.agentcommons/hook.log`. Please
redact anything sensitive.

## Security issues

See `SECURITY.md`: use GitHub private vulnerability reporting, not public issues.

## Blog posts

Add a Markdown file under `apps/dashboard/content/blog/`. Its filename must match
its slug. Include this frontmatter, then write the article below it:

```yaml
---
slug: your-post-title
title: Your post title
summary: One sentence describing the article.
date: "2026-09-08"
---
```

The dashboard build validates posts and generates their pages, metadata, sitemap,
and LLM discovery files. Customer instances do not serve the blog. Review public
copy with the repo's `no-ai-slop` skill and test the post on a phone-width viewport.
