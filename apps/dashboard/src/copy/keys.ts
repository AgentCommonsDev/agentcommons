/** Strings for the Keys page: the caller's keys, creation, the one-time secret and revocation. */
export const keysCopy = {
  title: "Keys",
  description:
    "API keys let coding tools upload sessions and let you or your agents read them. Every key belongs to this organization.",
  list: {
    label: "Your API keys",
    empty: "No API keys yet",
    emptyHint:
      "Create a key to connect a coding tool or an agent to this organization.",
    csvName: "api-keys.csv",
    revoke: "Revoke",
    active: "Active",
    revoked: "Revoked",
    never: "Never",
  },
  permissions: {
    label: "Permissions",
    ingest: "Ingest",
    read: "Read",
    dashboards: "Dashboard tools",
    administration: "Administration tools",
    admin: "Admin",
    ingestHint:
      "Upload sessions from coding tools on the machine that holds this key.",
    readHint:
      "Search and read this organization's sessions, in the app and through MCP. Agents see three MCP tools: search, get and sql.",
    dashboardsHint:
      "Adds the five dashboard tools to the agent's MCP catalog: list, get, render, save and delete. Requires Read. Keys made before this option lack it, so create a new key to grant it.",
    administrationHint:
      "Adds one MCP tool per admin action: members, keys, redaction policies and rescans, moderation, installations and metrics. Requires Admin and Read. The catalog grows from 9 KB to about 40 KB, which Claude Code loads on every turn.",
    adminHint:
      "Manage members, keys, redaction and moderation through the API. Only owners and admins can grant this.",
    none: "No permissions",
    required: "Pick at least one permission.",
  },
  create: {
    action: "Create key",
    title: "Create an API key",
    description:
      "The key carries only the permissions you pick and can be revoked at any time.",
    name: "Name",
    nameHint: "Name the machine or integration that will use this key.",
    namePlaceholder: "Work laptop",
    expires: "Expires after",
    expiresUnit: "days",
    expiresHint: "Leave empty and the key never expires. Up to 365 days.",
    submit: "Create key",
    pending: "Creating…",
  },
  secret: {
    title: "Copy your key now",
    description:
      "This is the only time the key is shown. Store it somewhere safe.",
    key: "API key",
    copyKey: "Copy key",
    command: "Install command for this key",
    commandHint:
      "Run it on the machine you want to connect. The command contains the key, so treat it like a password.",
    copyCommand: "Copy install command",
    done: "I saved the key",
  },
  reveal: {
    copy: "Copy key",
    copied: "Key copied",
    failed: "Copy failed. Reload the page and try again.",
    pick: "Key",
    pickHint: "Keys you created earlier can be used again.",
    pickNone: "Choose a key",
    noKeys: "You have no active key with ingest and read permissions yet.",
  },
  revoke: {
    title: "Revoke this key?",
    description:
      "Requests that use this key stop working immediately. The audit log keeps its history.",
    confirm: "Revoke key",
  },
} as const;
