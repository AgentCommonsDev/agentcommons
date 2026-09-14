import {
  toolPolicySchema,
  type ToolPolicy,
  type ToolPolicyRule,
} from "../schemas/tool-policy.js";

/**
 * The shipped default preset (ADR 0080): high-value guardrails against the commands most
 * likely to destroy data, exfiltrate secrets, or disable safety. Every rule matches any
 * harness and any tool that carries a command, so it applies across Claude Code, Codex,
 * Gemini CLI and pi. The preset is delivered with the policy DISABLED, so it enforces
 * nothing until an admin turns the policy on; admins can then keep, edit, or remove rules.
 */
const PRESET_RULES: ToolPolicyRule[] = [
  {
    id: "destructive-recursive-remove",
    description:
      "Recursive force-delete of a root, home, or wildcard path (rm -rf / and kin).",
    harnesses: [],
    tool: "*",
    command_patterns: [
      {
        kind: "regex",
        value:
          "\\brm\\s+(?:-[a-zA-Z]+\\s+)*-[a-zA-Z]*[rR][a-zA-Z]*[fF]|\\brm\\s+(?:-[a-zA-Z]+\\s+)*-[a-zA-Z]*[fF][a-zA-Z]*[rR]",
      },
    ],
    action: "deny",
    severity: "critical",
  },
  {
    id: "pipe-download-to-shell",
    description:
      "Piping a network download straight into a shell (curl … | sh).",
    harnesses: [],
    tool: "*",
    command_patterns: [
      {
        kind: "regex",
        value: "\\b(?:curl|wget)\\b[^|]*\\|\\s*(?:sudo\\s+)?(?:sh|bash|zsh)\\b",
      },
    ],
    action: "deny",
    severity: "high",
  },
  {
    id: "force-push-protected-branch",
    description:
      "Force-push to a protected branch (main, master, release, production).",
    harnesses: [],
    tool: "*",
    command_patterns: [
      {
        kind: "regex",
        value:
          "\\bgit\\s+push\\b[^\\n]*(?:--force\\b|--force-with-lease\\b|\\s-f\\b)[^\\n]*\\b(?:main|master|release|production|prod)\\b",
      },
    ],
    action: "deny",
    severity: "high",
  },
  {
    id: "read-credential-file",
    description:
      "Reading or copying a credential file (SSH keys, AWS creds, .env, .pem).",
    harnesses: [],
    tool: "*",
    command_patterns: [
      {
        kind: "regex",
        value:
          "\\b(?:cat|less|more|head|tail|cp|scp|rsync|curl|base64)\\b[^\\n]*(?:\\.ssh/id_|\\.aws/credentials|\\.netrc|credentials\\.json|\\.pem\\b|/\\.env\\b|\\benv\\b\\s*$)",
      },
    ],
    action: "warn",
    severity: "high",
  },
  {
    id: "write-to-system-or-secret-path",
    description:
      "Redirecting output into /etc, an env file, or a credential file.",
    harnesses: [],
    tool: "*",
    command_patterns: [
      {
        kind: "regex",
        value: ">>?\\s*(?:/etc/|[^\\s]*\\.env\\b|[^\\s]*\\.aws/credentials)",
      },
    ],
    action: "warn",
    severity: "medium",
  },
  {
    id: "disable-safety-guard",
    description:
      "Disabling a safety guard (skip permissions, skip git hooks, disable verification).",
    harnesses: [],
    tool: "*",
    command_patterns: [
      { kind: "substring", value: "--dangerously-skip-permissions" },
      { kind: "substring", value: "--no-verify" },
      {
        kind: "regex",
        value: "\\bgit\\s+(?:commit|push)\\b[^\\n]*--no-verify",
      },
    ],
    action: "warn",
    severity: "medium",
  },
];

/** A fresh organization's policy: the preset rules present, enforcement OFF. */
export function defaultToolPolicy(): ToolPolicy {
  return toolPolicySchema.parse({
    enabled: false,
    rules: PRESET_RULES,
  });
}

/** The preset rules alone, for tests and for restoring a rule an admin removed. */
export function presetRules(): ToolPolicyRule[] {
  return PRESET_RULES.map((rule) => ({ ...rule }));
}
