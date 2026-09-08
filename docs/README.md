# Documentation

Read in this order. Everything in the spec is built; there is no roadmap.

1. [`SPEC.md`](SPEC.md): the specification. Implementation-ready; every hook contract in it
   was captured live. Sections you will come back to: §4 data model, §5 ingest, §6 hook shim
   and install, §7 search/get/sql, §8 MCP, §9 auth and audit, §12 edge cases, Appendix A hook
   contracts, Appendix B configuration, Appendix C what the agent sees.
2. [`REQUIREMENTS.md`](REQUIREMENTS.md): the traceability matrix; every testable statement
   has an ID that tests cite. `pnpm spec:check` reports what is not yet implemented.
3. [`adr/`](adr/): one short record per decision, with the alternatives that were rejected.
   Read the ADR before proposing to change the thing it decides.

For agents: `../AGENTS.md` is the operating manual for this repo (`CLAUDE.md` and
`GEMINI.md` are symlinks to it). The
spec is long; use its table of contents and search for the section number you were pointed to.
