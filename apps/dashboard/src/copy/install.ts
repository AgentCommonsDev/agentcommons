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
    machine: "Machine name",
    machinePlaceholder: "Work laptop",
    submit: "Create key",
    created: "Key created. The install command in step 3 now includes it.",
  },
  prepare: {
    title: "Before you run it",
    description:
      "The machine needs Node.js 20 or newer and curl. The installer downloads the capture hook for Claude Code, Codex, Gemini CLI and pi, registers the AgentCommons MCP server with Claude Code, Codex and Gemini CLI so your coding agents can search AgentCommons before they start, and runs a check.",
    notesTitle: "Per tool",
    notes: {
      CLAUDE_CODE: "Sessions upload automatically once the hook is installed.",
      CODEX:
        "Asks you to trust the hooks once, interactively, before capture starts.",
      GEMINI_CLI: "Headless runs need GEMINI_API_KEY set in the environment.",
      PI: "The installer places the pi extension. Restart pi to load it. The extension captures sessions and gives pi the same AgentCommons tools.",
    },
  },
  run: {
    title: "Run this command on that machine",
    description:
      "Paste it into a terminal on the machine you are connecting. Run it again only on a new machine or to change the key; installed hooks update themselves.",
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
    untitled: "Untitled session",
  },
} as const;
