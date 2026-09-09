/** Strings for the organization Settings page. Owned by the settings feature. */
export const settingsCopy = {
  title: "Settings",
  description: "Organization-wide options. Changes apply to every member.",
  general: {
    title: "General",
    name: "Name",
    id: "Organization ID",
    slug: "Slug",
    role: "Your role",
  },
  embeddings: {
    title: "Search and embeddings",
    description:
      "Embeddings add semantic search and similar-session suggestions on top of keyword search.",
    toggle: "Embedding search",
    enabledHint:
      "New and existing sessions are queued for indexing. Search uses vectors as indexing progresses.",
    disabledHint:
      "Search uses words and filters. Existing vectors stay stored but hidden.",
    unavailable:
      "No embedding provider is configured on this instance. An operator has to configure one before embeddings can be enabled.",
    notEntitled: "Embeddings are included in the Pro with embeddings plan.",
    viewPlans: "View plans",
    enable: "Enable embeddings",
    disable: "Disable embeddings",
    enableTitle: "Enable embeddings?",
    enableDescription:
      "Searchable session text, including existing sessions, is sent to the configured provider. Provider charges and the daily token budget apply.",
    disableTitle: "Disable embeddings?",
    disableDescription:
      "New embedding requests stop. Requests already in flight may finish and incur provider costs.",
    provider: "Provider",
    model: "Model",
    total: "Sessions",
    indexed: "Indexed",
    pending: "Waiting",
    fake: "The test provider returns deterministic vectors. Its results say nothing about search quality.",
    failed:
      "The last provider request failed. Check the provider credential and usage limits.",
    unchecked:
      "No provider request has completed yet, so the credential is unverified.",
  },
  domains: {
    title: "Sign-in domains",
    description:
      "People who sign in with Google from one of these domains join this organization as members.",
    domain: "Email domain",
    placeholder: "example.com",
    hint: "The part after the @. Subdomains need their own entry.",
    add: "Add domain",
    adding: "Adding…",
    added: (domain: string) =>
      `${domain} added. Matching Google accounts can now join.`,
    disabled:
      "Domain sign-in needs Google login and a signup mode that allows enrollment. Ask your instance operator to enable it.",
    allowed: "Allowed",
    empty: "No domains yet",
    emptyHint: "Add a domain so people can join without being added by hand.",
  },
  dashboard: {
    title: "Home dashboard",
    description: "The dashboard members see when they open Home.",
    select: "Default dashboard",
    builtin: "Built in",
    builtinHint:
      "Team overview is the shipped dashboard. Choosing it restores the default view.",
    saved: "Home now shows this dashboard.",
    tiles: (count: number) =>
      count === 1 ? "1 tile" : `${String(count)} tiles`,
  },
} as const;
