/** Public site, SaaS offering and hosted-account strings, nested under `copy.site`. */
export const publicCopy = {
  saas: {
    signup: "Start free",
    pricing: "Pricing",
    pricingTitle: "Start free. Add capacity as you grow.",
    pricingDescription:
      "Each plan includes capture, search, and your organization's dashboard.",
    free: "Free",
    pro: "Pro",
    enterprise: "Enterprise",
    pro_embeddings: "Pro with embeddings",
    embeddingsAddon: "Embeddings add-on",
    captureRate: "per 1,000 additional captured records",
    embeddingRate: "per 1,000 indexed messages",
    rateUnavailable: "Usage rates are not configured for this instance.",
    freeDescription: "Try shared session history with your team.",
    proDescription: "Capture more of your team's daily work.",
    enterpriseDescription:
      "Discuss higher limits and your organization's needs.",
    freePrice: "$0",
    currency: "USD",
    perMonth: "/ month",
    sessionsPerMonth: "captured records included each month",
    counting:
      "Usage counts new transcript records. Retries do not count twice; rewritten snapshots can add records. Free allowances reset each UTC calendar month. Pro allowances reset with the subscription period.",
    included: [
      "Claude Code, Codex, Gemini CLI, and pi",
      "Search in the dashboard and through MCP",
      "Organization access and custom redaction policies",
    ],
    demo: "Schedule a demo",
    demoTitle: "Talk through your team's setup",
    demoDescription:
      "Choose a time in the calendar or open it in a separate tab.",
    openCalendar: "Open booking calendar",
    calendarTitle: "AgentCommons demo booking calendar",
    calendarUnavailable: "Demo scheduling is not configured for this instance.",
    calendarLoading: "Loading booking calendar…",
    status: "History, governance, and observability for your team’s agents.",
    principlesTitle: "Your team’s history, with organization controls.",
    madeIn: "Made in San Francisco",
    securityEyebrow: "ORGANIZATION ACCESS",
    securityHeading: "Agent history with\norganization governance.",
    securityDescription:
      "Organization boundaries and scoped keys control who can read and contribute. Owners manage membership, and admins can hide or purge sessions.",
    footerStatus: "Shared across coding tools",
    checkoutUnavailable:
      "Online upgrades are not configured for this instance. Your current plan remains available.",
    unavailable:
      "Hosted signup and billing are not available on this instance.",
  },
  blog: {
    title: "Notes on shared agent work",
    description:
      "Practical ways to capture coding history, find prior work, and keep team instructions useful.",
    navigation: "Blog",
    back: "All posts",
    published: "Published",
  },
  signup: {
    openDashboard: "Open dashboard",
    dashboardShort: "Dashboard",
    continueSetup: "Continue setup",
    signInDescription: "Sign in to access your team’s shared session history.",
    title: "Create your AgentCommons account",
    description: "Verify your email, then create a workspace for your team.",
    name: "Your name",
    submit: "Create account",
    submitting: "Creating account…",
    failed: "The account could not be created.",
    verifyTitle: "Check your email",
    verifyEmail: "Verify your email",
    verifyRequestDescription:
      "Request an email verification link before signing in to an account added by your organization.",
    verifySubmit: "Send verification link",
    verifyDescription:
      "Open the verification link to continue setting up your workspace.",
    resend: "Send another verification email",
    sending: "Sending email…",
    sent: "A new verification email has been requested.",
    emailFailed: "The email could not be sent.",
    already: "Already have an account?",
    signIn: "Sign in",
    unavailable: "Public signup is not enabled for this instance.",
    forgot: "Forgot your password?",
    resetTitle: "Reset your password",
    resetDescription: "Request a password reset link for your account.",
    resetSubmit: "Send reset link",
    resetSent:
      "If an account can use password reset, a link will arrive by email.",
    onboardingTitle: "Create your team's workspace",
    onboardingDescription:
      "Your organization keeps its sessions, members, and API keys together.",
    organizationName: "Organization name",
    slug: "Organization slug",
    organizationSubmit: "Create organization",
    organizationPending: "Creating organization…",
    contactTitle: "Contact your organization owner",
    contactDescription:
      "This account has already created an organization. Ask its owner to restore access.",
    continue: "Continue to your workspace",
  },
  startup: {
    failed: "The application configuration could not be loaded.",
    retry: "Reload page",
  },
  meta: {
    title:
      "AgentCommons · History, governance, and observability for coding agents",
    description:
      "Search your team's coding-agent sessions, see what agents did, and enforce redaction and access rules once. Teams and their agents get more effective.",
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Self-hosted web application",
    language: "en",
  },
  brand: "AgentCommons",
  skip: "Skip to content",
  navigation: {
    label: "Main navigation",
    product: "How it works",
    principles: "Your data",
    docs: "Documentation",
    login: "Sign in",
    home: "AgentCommons home",
  },
  hero: {
    eyebrow: "HISTORY, GOVERNANCE, AND OBSERVABILITY",
    title: "Give your next agent",
    titleEnd: "a place to start.",
    description:
      "Search your team's prior agent work, see what agents are doing now, and enforce access and redaction rules once. Every person and agent gets more effective.",
    primary: "Open your workspace",
    secondary: "Explore the project",
    status:
      "Self-hosted history, governance, and observability for your agents.",
  },
  preview: {
    eyebrow: "SEARCH FOR PEOPLE AND AGENTS",
    heading: "Search the team’s session history.",
    description:
      "Agents use MCP. People use the dashboard. Both can follow a result back to the session where the work happened.",
    badge: "Interactive example",
    label: "Example MCP tools",
    address: "workspace / payments-api",
    prompt: "Has anyone worked on webhook retries?",
    commandLabel: "Example MCP request",
    source: "Illustrative session data",
    tabs: [
      { id: "search", label: "search", caption: "Find prior work" },
      { id: "get", label: "get", caption: "Read the source" },
      { id: "sql", label: "sql", caption: "Ask across sessions" },
    ],
    search: {
      command:
        'search({ query: "webhook retries", filters: { repo_name: "payments-api" } })',
      count: "2 relevant sessions",
      results: [
        {
          title: "Keep retries safe after a timeout",
          tool: "Claude Code",
          branch: "fix/webhook-retries",
          line: "The provider can accept an event before our request times out. Reuse the same idempotency key when retrying.",
          meta: "Session 01 · messages 18–24",
          tag: "Decision",
        },
        {
          title: "Trace the duplicate delivery",
          tool: "Codex",
          branch: "investigate/duplicates",
          line: "A timeout triggered a second delivery with a new key. The regression test reproduces both requests.",
          meta: "Session 02 · messages 7–12",
          tag: "Investigation",
        },
      ],
    },
    get: {
      command:
        'get({ session_id: "00000000-0000-4000-8000-000000000001", from: 18, to: 21 })',
      title: "Keep retries safe after a timeout",
      meta: "Claude Code · fix/webhook-retries",
      rows: [
        {
          number: "18",
          role: "USER",
          text: "Why do we deliver the webhook twice after a timeout?",
        },
        {
          number: "19",
          role: "ASSISTANT",
          text: "The retry creates a new idempotency key. I’ll check whether the provider accepted the first request.",
        },
        {
          number: "20",
          role: "TOOL RESULT",
          text: "delivery.test.ts · reproduces duplicate delivery after timeout",
        },
        {
          number: "21",
          role: "ASSISTANT",
          text: "Reuse the original key across retries. That lets the provider recognize the first delivery.",
        },
      ],
    },
    sql: {
      command: "sql({ sql: … })",
      query:
        "SELECT repo_name, count(*) AS sessions\nFROM sessions\nGROUP BY repo_name\nORDER BY sessions DESC;",
      columns: ["repo_name", "sessions"],
      rows: [
        ["payments-api", "12"],
        ["web-console", "8"],
        ["worker", "5"],
      ],
      note: "Read-only queries over the sessions your key can access.",
    },
    footer:
      "Follow the evidence. Keep the session, tool output, and decisions together.",
  },
  flow: {
    eyebrow: "FROM THE FIRST PROMPT TO THE NEXT TASK",
    heading: "Your tools change.\nYour history stays with the team.",
    description:
      "Capture work where it happens, then make it available to the next person or agent. No need to move every investigation into chat.",
    capture: "Capture at the source",
    sources: ["Claude Code", "Codex", "Gemini CLI", "pi"],
    sourcesNote: "Capture from Claude Code, Codex, Gemini CLI, and pi.",
    center: "Organization history",
    centerDetail: "Redact · index · link",
    destinations: [
      { title: "For agents", description: "MCP search, get, sql" },
      { title: "For people", description: "Search, dashboards, and SQL" },
    ],
    diagramLabel:
      "Coding tools send sessions to organization history. Agents access the history through MCP and people through the dashboard.",
  },
  principles: {
    eyebrow: "CONTEXT YOU CAN TRACE",
    heading: "Keep the reasoning\nbehind the repository.",
    cards: [
      {
        title: "Pick up where the work left off.",
        description:
          "Find an earlier investigation before repeating it. Inspect the prompts, tool output, and failed approaches behind a result.",
        label: "01 / CONTINUITY",
      },
      {
        title: "Keep instructions connected to evidence.",
        description:
          "AGENTS.md, CLAUDE.md, and skills define how your team works. Session history records the work that informed those instructions.",
        label: "02 / COORDINATION",
      },
      {
        title: "Follow the whole session.",
        description:
          "Keep subagent and fork relationships visible, so you can trace a decision across the work that led to it.",
        label: "03 / PROVENANCE",
      },
    ],
  },
  security: {
    eyebrow: "RUN IT ON YOUR INFRASTRUCTURE",
    heading: "Governance on\nyour infrastructure.",
    description:
      "A self-hosted application for shared agent history, governance, and observability. Organization boundaries and scoped keys control who can read and contribute.",
    items: [
      {
        title: "Redaction before server storage",
        description:
          "Scan session content and metadata before writing them. Add custom redaction policies for your organization.",
      },
      {
        title: "Explicit access and audit records",
        description:
          "Use organization membership and scoped keys. Review reads, changes, and administrative actions.",
      },
      {
        title: "Control what stays visible",
        description:
          "Hide or purge sessions through organization administration. Customer deployments disable public discoverability by default.",
      },
    ],
    note: "Review the security model and verification results before deploying.",
    link: "Read the security model",
  },
  closing: {
    eyebrow: "BUILD ON WORK THAT ALREADY HAPPENED",
    heading: "Start with the team's context.",
    description:
      "Open your workspace or explore the code and deployment instructions.",
    primary: "Open your workspace",
    secondary: "Read the documentation",
  },
  footer: {
    description: "History, governance, and observability for coding agents.",
    source: "Apache 2.0 license",
    status: "Self-hosted session history",
    links: {
      source: "Source code",
      specification: "Specification",
      security: "Security",
      license: "License",
    },
  },
  notFound: {
    title: "This page is not available.",
    description: "Return to the project or open your workspace to continue.",
    action: "Back to AgentCommons",
  },
  discovery: {
    documentation: "Documentation",
    guide: "Public product guide",
    full: "Full public documentation",
    readme: "Project README",
  },
  publicGuide: {
    title: "AgentCommons public product guide",
    sections: [
      "AgentCommons gives organizations shared history, governance, and observability for coding-agent sessions. Agents access session history through MCP; people use a web dashboard with search, dashboards, and SQL. Teams and their agents get more effective because nobody repeats work, leaders see what agents are doing, and admins enforce controls once for everyone.",
      "Agents use search to find prior work, get to read a session, and sql to query the data they can access. They can also save personal dashboard definitions through MCP. The example on the public homepage uses illustrative data and does not connect to an organization's sessions.",
      "Versioned AGENTS.md, CLAUDE.md, and skills contain team instructions. Session history records prior investigations, failed approaches, tool outputs, and decisions. Capture adapters record sessions from Claude Code, Codex, Gemini CLI, and pi.",
      "Organizations have separate data, membership, and scoped API keys. Redaction runs before server storage. Administrators manage visibility, purge, redaction policies, and audit records.",
      "Customer instances disable public discoverability by default. Login and authenticated workspace pages are not intended for indexing. Public discovery files contain only this guide and repository documentation, never organization session data.",
    ],
  },
} as const;

export const links = {
  repository: "https://github.com/rek7/agentcommons",
  specification: "https://github.com/rek7/agentcommons/blob/main/docs/SPEC.md",
  security: "https://github.com/rek7/agentcommons/blob/main/SECURITY.md",
  license: "https://github.com/rek7/agentcommons/blob/main/LICENSE",
} as const;
