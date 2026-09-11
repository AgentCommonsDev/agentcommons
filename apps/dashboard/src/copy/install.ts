/** Strings for the Install page: four steps from key to first captured session. */
export const installCopy = {
  title: "Install",
  description:
    "One command connects the coding tools on a machine to this organization. It installs the capture hook for Claude Code, Codex, Gemini CLI and pi.",
  command: {
    copy: "Copy install command",
    pending: "Create or choose a key first.",
    secretHint:
      "The command contains your key. Treat it like a password and run it only on machines you trust.",
  },
  step: "Step",
  key: {
    title: "Create a key for this machine",
    description:
      "The key lets the machine upload sessions and read them back. Name it after the machine so you can tell keys apart later.",
    chooseTitle: "Choose the key for this machine",
    chooseDescription:
      "Pick one of your active keys with ingest and read permissions. The command in step 3 takes it.",
    useExisting: "Use a key you already have instead",
    createNew: "Create a new key instead",
    machine: "Machine name",
    machinePlaceholder: "Work laptop",
    submit: "Create key",
    created: "Key created. The install command in step 3 now includes it.",
  },
  prepare: {
    title: "Before you run it",
    description:
      "The machine needs Node.js 20 or newer and curl. One command does the rest; your repositories are not touched.",
    does: {
      hook: {
        title: "Capture hook",
        detail: "Claude Code, Codex, Gemini CLI and pi",
      },
      mcp: {
        title: "MCP server",
        detail:
          "search, get and sql in Claude Code, Codex and Gemini CLI, and in pi through its extension. Dashboard tools need a key that grants them.",
      },
      guidance: {
        title: "Search-first guidance",
        detail:
          "Added to each tool's global instructions: ~/.claude/CLAUDE.md, ~/.codex/AGENTS.md, ~/.gemini/GEMINI.md",
      },
      updates: {
        title: "Self-check and updates",
        detail: "Hooks update themselves from this server",
      },
    },
    repository: {
      title: "Guidance for a repository",
      description:
        "The first captured session in a checkout adds the same block to its AGENTS.md and links CLAUDE.md and GEMINI.md to it. Commit those three files so every teammate's agent reads the guidance, on machines with or without the install. Nothing else to do here.",
      show: "Optional: add it now",
      hide: "Hide the optional step",
      command:
        "To add the block before the first session, run this in the checkout.",
      copyCommand: "Copy command",
      off: "To keep a repository out, run the command with --off in that checkout. It removes the block and records the choice. To turn the automatic write off for a machine, set guidance.auto to false in ~/.agentcommons/config.json or export AGENTCOMMONS_GUIDANCE_AUTO=0.",
      manual:
        "Without the install, paste this block into AGENTS.md at the repository root, with CLAUDE.md and GEMINI.md as symlinks or copies.",
      copy: "Copy repository guidance",
    },
    notesTitle: "Good to know",
    notes: {
      CODEX: "Trust the hooks once when Codex asks.",
      GEMINI_CLI: "Headless runs need GEMINI_API_KEY.",
      PI: "Restart pi after installing.",
    },
  },
  run: {
    title: "Run this command on that machine",
    description:
      "Paste it into a terminal on the machine you are connecting. Run it again only on a new machine or to change the key; installed hooks update themselves.",
    shellHint:
      "Then open a new terminal so Codex sees the key. The installer adds it to your bash, zsh and fish startup files.",
  },
  arrivals: {
    title: "Start a coding agent",
    description:
      "Open Claude Code, Codex, Gemini CLI or pi on that machine and send a prompt. Sessions uploaded with the key from step 1 appear here within seconds and stay under Sessions.",
    pending: "Create or choose a key in step 1 to see the sessions it uploads.",
    polling: "Checking for this machine's sessions every 5 seconds",
    empty: "No sessions from this machine yet",
    emptyHint:
      "Start Claude Code, Codex, Gemini CLI or pi on the connected machine and send at least one prompt. Only sessions uploaded with the key from step 1 are listed.",
    allSessions: "All sessions",
  },
  admin: {
    title: "Administrator install",
    description:
      "The key created here also carries Admin and the administration and dashboard tool groups, so your agent can manage members, keys, redaction, moderation and installations through MCP, next to search, get and sql. Only owners and admins see this section.",
    catalog:
      "The agent's MCP catalog grows from 3 tools in 9 KB to about 36 tools in 40 KB. The installer marks the agentcommons server as always loaded, so Claude Code keeps the whole catalog in context on every turn, about 10,000 tokens. Use this key only on machines where you administer the organization.",
    upgrade:
      "To upgrade a machine that already has the standard key, run the step 3 command there again. The installer replaces the key; the hook and MCP server names stay the same.",
    machine: "Machine name",
    machinePlaceholder: "Admin laptop",
    submit: "Create administrator key",
    created:
      "Administrator key created. The install command in step 3 now includes it.",
  },
} as const;
