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
        "The same guidance, framed for a project. Add it to AGENTS.md at the repository root, with CLAUDE.md and GEMINI.md as symlinks or copies, and commit it. Every teammate's agent then reads it, on machines with or without the install.",
      command:
        "On a machine with the install, this command writes and links the files for you:",
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
      "Open Claude Code, Codex, Gemini CLI or pi on that machine and send a prompt. The session appears below within seconds and stays under Sessions.",
    polling: "Checking for new sessions every 5 seconds",
    empty: "No sessions from you yet",
    emptyHint:
      "Start Claude Code, Codex, Gemini CLI or pi on the connected machine and send at least one prompt.",
    allSessions: "All sessions",
  },
} as const;
