/**
 * Privacy Policy and Terms of Service for the hosted service at agentcommons.dev, plus
 * the agreement line shown on signup and onboarding. Both documents are data rendered
 * by one `LegalPage` component. Facts here mirror the spec and the deployed
 * infrastructure (§9.5, §9.6, §11, infra/): change the source, then this text.
 */
interface LegalItem {
  /** Optional bold lead-in, written with its own trailing period. */
  term?: string;
  text: string;
}
interface LegalSection {
  heading: string;
  paragraphs: readonly string[];
  items?: readonly LegalItem[];
  /** Paragraphs shown after the list. */
  closing?: readonly string[];
}
export interface LegalDocument {
  title: string;
  /** One sentence for the page's meta description. */
  description: string;
  /** ISO date for the `<time>` element. */
  effective: string;
  effectiveText: string;
  intro: readonly string[];
  sections: readonly LegalSection[];
}

const operator = "ZeroPath";
const contactEmail = "legal@agentcommons.dev";
const effective = "2026-09-08";
const effectiveText = "September 8, 2026";
const entityPlaceholder =
  "[Legal entity name and registered address to be confirmed by counsel]";

const privacy: LegalDocument = {
  title: "Privacy Policy",
  description:
    "What ZeroPath collects on the hosted AgentCommons service at agentcommons.dev, how it is used, who else handles it, how long it is kept, and how to reach us.",
  effective,
  effectiveText,
  intro: [
    `${operator} operates the hosted AgentCommons service at agentcommons.dev. This policy explains what we collect when you use it, why we collect it, who else handles it, how long we keep it, and how to reach us.`,
    "AgentCommons is also open-source software that organizations run on their own infrastructure. A self-hosted instance sends no data to ZeroPath, and this policy does not cover it. The operator of a self-hosted instance is responsible for its own notices.",
  ],
  sections: [
    {
      heading: "Who is responsible for your data",
      paragraphs: [
        "Your organization decides which coding-agent sessions its installed hooks upload, who may read them, which redaction policies apply, and when a session is hidden or purged. For session content, ZeroPath processes data on your organization's instructions. For account, sign-in, and billing information, ZeroPath decides how the data is used.",
        "Where data protection law distinguishes a controller from a processor, ZeroPath is the processor for session content and the controller for account, sign-in, and billing information. Members with questions about how their organization uses AgentCommons should contact the organization's owner.",
      ],
    },
    {
      heading: "Information we collect",
      paragraphs: ["We collect the following categories of information."],
      items: [
        {
          term: "Account information.",
          text: "Your name, email address, and a hash of your password when you sign up with a password. If you sign in with Google, we receive your Google account identifier, email address, name, profile image URL, and email verification status. Each sign-in session records the IP address, browser user agent, and time of sign-in.",
        },
        {
          term: "Organization information.",
          text: "The organization's name and derived URL slug, the email addresses of members added by its administrators, membership roles, allowlisted Google sign-in domains, redaction policies, dashboards, and settings such as whether embeddings are enabled.",
        },
        {
          term: "API keys.",
          text: "Scoped keys that members create for machines and agents. We store a hash of each key, its name, its permissions, and the time it was last used. Keys carry the ac_ prefix so secret scanners can recognize them.",
        },
        {
          term: "Session transcripts.",
          text: "Records uploaded by the hooks your organization installs in Claude Code, Codex, Gemini CLI, or pi. A record can contain prompts, assistant replies, tool calls, and tool output, and anything those include: source code, file paths, shell output, error messages, and data returned by tools. Each upload also carries the working directory, git context (repository root, remote URL, branch, and commit SHA), installation details (hostname, operating system user name, platform, and CPU architecture), session identifiers, timestamps, and parent, subagent, and fork relationships.",
        },
        {
          term: "Usage information.",
          text: "Counts of newly accepted transcript records and, when embeddings are enabled, of successfully indexed messages per organization and billing period. On paid plans these counts are sent to Stripe as meter events.",
        },
        {
          term: "Billing information.",
          text: "Stripe customer and subscription identifiers, plan, and paid period. Stripe collects and stores payment card details. We never receive the full card number.",
        },
        {
          term: "Audit events.",
          text: "Every read and write through the dashboard, REST API, or MCP writes one audit event: the actor, key, organization, IP address, user agent, transport, action, affected resource identifiers, status code, duration, and a redacted detail field of at most 8 KB. Failed sign-ins are audited too.",
        },
        {
          term: "Correspondence.",
          text: "Email you send to us and our replies.",
        },
      ],
      closing: [
        "The public website sets no analytics or advertising cookies. Your theme choice is kept in your browser's local storage and never sent to us. When a demo booking calendar is configured, it is embedded from Cal.com, and what you enter there goes to Cal.com.",
      ],
    },
    {
      heading: "Redaction before storage",
      paragraphs: [
        "Every free-text field passes through redaction before it is written, including transcript records, git fields, titles, and audit detail. Shipped rules cover common credential formats. Organization administrators can add regular-expression rules or preinstalled secretlint rules and rescan existing sessions from the raw records.",
        "Redaction matches known patterns, so a secret in an unusual format can survive it. Treat transcripts as sensitive, restrict who can read them, and purge sessions that should not have been captured. A pattern that survives redaction is a security issue; the Security section explains how to report one.",
      ],
    },
    {
      heading: "How we use information",
      paragraphs: ["We use the information above for these purposes."],
      items: [
        {
          term: "Providing the service.",
          text: "Storing transcripts for your organization, indexing them for search, showing them in the dashboard, and answering agent requests through MCP.",
        },
        {
          term: "Access control and audit.",
          text: "Enforcing organization boundaries, membership roles, and key permissions, and keeping the audit trail that administrators review.",
        },
        {
          term: "Billing.",
          text: "Counting usage, enforcing plan allowances, and charging paid plans through Stripe.",
        },
        {
          term: "Transactional email.",
          text: "Sending email verification, password reset, and welcome messages. We send no marketing email.",
        },
        {
          term: "Security and abuse prevention.",
          text: "Rate limiting, investigating suspected misuse, and protecting the service and other customers.",
        },
        {
          term: "Support and legal compliance.",
          text: "Answering your requests and meeting legal obligations.",
        },
      ],
      closing: [
        "We do not sell personal information, we show no advertising, and we do not use your transcripts to train machine-learning models.",
      ],
    },
    {
      heading: "Embeddings",
      paragraphs: [
        "Embeddings are off by default. When an organization administrator turns them on and the operator has configured a provider, the text of searchable messages, in chunks of about 512 tokens, and a short per-session summary are sent to OpenAI to compute vectors under OpenAI's API terms. The vectors are stored with your organization's data. Turning embeddings off stops further provider calls and hides the existing vectors. Purging a session deletes its vectors.",
      ],
    },
    {
      heading: "Who we share information with",
      paragraphs: ["We share information only in these cases."],
      items: [
        {
          term: "Your organization.",
          text: "Members see the sessions their role permits. Agents holding a scoped API key see only what that key permits. Administrators see audit events, membership, and the retained identity of purged sessions.",
        },
        {
          term: "Subprocessors.",
          text: "Amazon Web Services hosts the service, including compute, PostgreSQL, ClickHouse, backups, and email delivery through Amazon SES or a configured SMTP provider. Stripe processes payments. Google provides sign-in when your organization uses it. OpenAI computes embeddings when an organization enables them. Cal.com hosts the demo booking calendar on the public site. Each processes data only to provide its service to us.",
        },
        {
          term: "Legal requirements.",
          text: "We disclose information when the law requires it, to enforce these terms, or to protect the rights and safety of ZeroPath, our customers, or the public. Where the law allows, we notify the affected organization first.",
        },
        {
          term: "Business transfers.",
          text: "If ZeroPath is acquired or merges with another company, this policy continues to apply to the transferred data until a new policy replaces it.",
        },
      ],
    },
    {
      heading: "Where data is stored",
      paragraphs: [
        "The hosted service runs in Amazon Web Services in the United States (us-east-1). Databases and backups are encrypted at rest, and connections to the service use TLS. If you are outside the United States, your data is transferred to and processed there.",
      ],
    },
    {
      heading: "How long we keep information",
      paragraphs: ["Retention depends on the kind of data."],
      items: [
        {
          term: "Session transcripts.",
          text: "Kept until an organization administrator purges the session or the organization is deleted. Purge hides the session immediately, including from administrators, and a background job removes the raw records, messages, files, and vectors. A compact identity record, admission and usage ledgers, and redacted audit events remain.",
        },
        {
          term: "Backups.",
          text: "Database backups and trace volume snapshots are kept for up to 35 days and then expire. Purged content can persist in a backup for that period.",
        },
        {
          term: "Audit events.",
          text: "Kept for 365 days by default.",
        },
        {
          term: "Account information.",
          text: `Kept while your account exists. Email ${contactEmail} to delete your account. We remove it within 30 days unless a legal obligation, or an organization you still own, requires otherwise.`,
        },
        {
          term: "Billing records.",
          text: "Kept for as long as tax and accounting law requires.",
        },
      ],
    },
    {
      heading: "Security",
      paragraphs: [
        "Database row policies enforce organization isolation on every read and write. API keys are hashed and scoped. Redaction runs before any write. Server logs never contain request bodies. Databases and backups are encrypted at rest, traffic uses TLS, and the code is open for review at github.com/rek7/agentcommons.",
        "No system is perfectly secure. Report a vulnerability through GitHub's private vulnerability reporting for the repository. We acknowledge reports within two business days and share a fix or mitigation plan within fourteen.",
      ],
    },
    {
      heading: "Your rights and choices",
      paragraphs: [
        "You can read and export your organization's data in the dashboard: sessions through search, SQL, and CSV export, and every other record through the REST API. Organization administrators can hide or purge sessions at any time.",
        `Depending on where you live, you may have the right to access, correct, delete, or receive a copy of your personal information, to object to or restrict its processing, and to complain to a supervisory authority. Email ${contactEmail} to exercise a right. We respond within 30 days and may ask you to verify your identity. If your request concerns transcripts uploaded by an organization, we forward it to that organization's owner, who controls that data.`,
        "We do not treat anyone differently for exercising a right.",
      ],
    },
    {
      heading: "Children",
      paragraphs: [
        "The service is for professional use and is not directed to anyone under 16. We delete accounts we learn belong to children.",
      ],
    },
    {
      heading: "Changes to this policy",
      paragraphs: [
        "We post changes here with a new effective date. For material changes, we email organization owners at least 14 days before the change takes effect.",
      ],
    },
    {
      heading: "Contact",
      paragraphs: [
        `${operator}, San Francisco, California. Email ${contactEmail} for privacy questions and requests.`,
        entityPlaceholder,
      ],
    },
  ],
};

const terms: LegalDocument = {
  title: "Terms of Service",
  description:
    "The agreement between ZeroPath and the people and organizations that use the hosted AgentCommons service at agentcommons.dev.",
  effective,
  effectiveText,
  intro: [
    `These terms are an agreement between ${operator} and you. They govern the hosted AgentCommons service at agentcommons.dev. By creating an account, joining an organization, or using the service, you accept them. If you act for an organization, you confirm that you have authority to bind it, and "you" means that organization.`,
    "The AgentCommons software is open source under the Apache License 2.0. Running your own instance is governed by that license, not by these terms.",
  ],
  sections: [
    {
      heading: "The service",
      paragraphs: [
        "AgentCommons captures coding-agent sessions from hooks installed in Claude Code, Codex, Gemini CLI, and pi, stores them per organization, redacts them before storage, and makes them searchable for people in a dashboard and for agents through MCP. Plans differ in the number of transcript records included each period, as described under Plans and billing.",
      ],
    },
    {
      heading: "Accounts and organizations",
      paragraphs: ["Your account is yours to protect."],
      items: [
        {
          text: "Provide accurate information and keep it current. Password accounts must verify their email address before creating an organization or reading transcripts.",
        },
        {
          text: `Keep your password and API keys secret. You are responsible for activity under your account and under keys created by your members. Revoke a key immediately if it may have leaked, and tell us at ${contactEmail} if you suspect unauthorized access.`,
        },
        {
          text: "Organization owners and administrators manage members, roles, keys, sign-in domains, redaction policies, session visibility, and purge. Their actions bind the organization.",
        },
        {
          text: "You must be at least 16 years old and legally able to enter a contract.",
        },
      ],
    },
    {
      heading: "Your data",
      paragraphs: [
        'You own the transcripts, prompts, code, and other content your organization uploads ("Customer Data"). You grant ZeroPath a non-exclusive, worldwide license to host, copy, redact, index, transmit, and display Customer Data only as needed to provide, secure, and support the service and to comply with the law. The license ends when the data is deleted.',
        "We do not use Customer Data to train machine-learning models, sell it, or use it for advertising. Our staff see Customer Data only to operate the service, to help you at your request, or to investigate abuse or a security incident.",
        "You are responsible for Customer Data: for having the rights and consents needed to upload it, including from colleagues whose prompts and work appear in sessions, for configuring hooks and redaction policies, and for deciding who may read it. Redaction is a filter and can miss secrets. Rotate any credential you find in a transcript.",
        "The Privacy Policy describes what we collect and how we handle personal information. It is part of these terms.",
      ],
    },
    {
      heading: "Acceptable use",
      paragraphs: ["You agree not to do any of the following."],
      items: [
        {
          text: "Access or attempt to access another organization's data, or bypass row policies, key permissions, or usage limits.",
        },
        {
          text: "Probe, scan, or load-test the service without written permission. Report vulnerabilities through the repository's private vulnerability reporting instead.",
        },
        {
          text: "Upload content you have no right to share, content that infringes intellectual property or privacy rights, or content that is unlawful where you or we are located.",
        },
        {
          text: "Resell the service, offer it to third parties as a service, or use it to build a competing hosted product without our written agreement.",
        },
        {
          text: "Interfere with the service or other customers, including by sending traffic beyond what your plan and normal use require.",
        },
      ],
      closing: [
        "Transcripts of security work on systems you are authorized to test are permitted content.",
      ],
    },
    {
      heading: "Plans and billing",
      paragraphs: [
        "Free costs $0 and includes the monthly allowance of newly captured transcript records shown on the pricing page. The allowance resets each UTC calendar month. When it is reached, new captures are refused until the reset or an upgrade. The hook keeps the pending batch and retries later, and your saved history stays searchable.",
        "Pro costs $100 per organization per month and includes the per-period allowance of captured records shown on the pricing page. Records beyond the allowance are charged at the per-1,000 rate shown on the pricing page and at checkout. The embeddings add-on costs $50 per month plus the per-1,000 indexed-messages rate shown at checkout.",
        "Usage counts newly accepted transcript records. Retries of the same record do not count twice; a rewritten snapshot can add records. The dashboard shows estimates. Your Stripe invoice is authoritative.",
        "Only an organization owner can start, change, or cancel a subscription, through Stripe Checkout and the Stripe customer portal. Subscriptions renew monthly until canceled. Cancellation takes effect at the end of the paid period, and Pro remains available until then. We do not refund partial periods unless the law requires it.",
        "Prices exclude taxes, which we add where required. We give at least 30 days' notice by email before a price increase. Continuing to use a paid plan after the change takes effect accepts the new price.",
        "If a payment fails, Stripe retries it. While a subscription is incomplete, past due, unpaid, expired, or canceled, the organization is treated as Free.",
        "Enterprise deployments are covered by a separate written agreement.",
      ],
    },
    {
      heading: "Availability and support",
      paragraphs: [
        "We aim to keep the service available at all times, but Free and Pro carry no uptime commitment and no service credits. We may run maintenance, and we may change or remove features. If a change materially reduces functionality you pay for, we tell organization owners in advance.",
        `Account and billing questions go to ${contactEmail}. Product questions and bug reports go to the public repository at github.com/rek7/agentcommons. We answer as quickly as we can and promise no response times on Free or Pro.`,
      ],
    },
    {
      heading: "Confidentiality",
      paragraphs: [
        "Each party protects the other's confidential information with at least the care it uses for its own, and uses it only for this agreement. Customer Data is your confidential information. Non-public information about the service is ours. The obligation does not cover information that is public, already known to the recipient, independently developed, or received from a third party without restriction. A party may disclose confidential information when the law requires, after giving notice where permitted.",
      ],
    },
    {
      heading: "Intellectual property",
      paragraphs: [
        "ZeroPath and its licensors own the service, its design, and its trademarks. The source code is licensed under the Apache License 2.0 at github.com/rek7/agentcommons. If you send us feedback, we may use it without obligation to you.",
      ],
    },
    {
      heading: "Third-party services",
      paragraphs: [
        "The service works with Claude Code, Codex, Gemini CLI, pi, Stripe, Google, OpenAI, and Cal.com. Your use of those products is governed by their own terms. We are not responsible for them.",
      ],
    },
    {
      heading: "Suspension and termination",
      paragraphs: [
        `You may stop using the service at any time. An owner can purge sessions and ask us at ${contactEmail} to delete the organization and its accounts.`,
        "We may suspend or end your access if you break these terms, do not pay, create a security or legal risk, or if the law requires it. Where practical, we warn you first and give you time to fix the problem.",
        "When an organization is deleted, we delete its Customer Data within 30 days, apart from backups that expire on their 35-day schedule and records the law requires us to keep. Fees already owed remain payable. The sections on your data, confidentiality, disclaimers, limitation of liability, and governing law survive termination.",
      ],
    },
    {
      heading: "Disclaimers",
      paragraphs: [
        "The service is provided as is and as available. We do not warrant that it is error-free or uninterrupted, that search results are complete, that redaction catches every secret, or that it fits a particular purpose. Transcripts reflect what your tools produced; we do not review them. Where the law does not permit these exclusions, they apply to the extent it does.",
      ],
    },
    {
      heading: "Limitation of liability",
      paragraphs: [
        "To the extent the law allows, neither party is liable for indirect, incidental, special, consequential, or punitive damages, or for lost profits, revenue, or data, however caused. Each party's total liability under these terms is limited to the fees you paid us in the 12 months before the claim, or $100 if you paid none. These limits do not apply to a breach of confidentiality, infringement of the other party's intellectual property, your payment obligations, or liability that the law does not allow to be limited.",
      ],
    },
    {
      heading: "Indemnity",
      paragraphs: [
        "You will defend and indemnify ZeroPath against third-party claims arising from Customer Data or from your use of the service in breach of these terms. We will defend and indemnify you against third-party claims that the service, used as permitted, infringes their intellectual property. Each party must notify the other promptly and let it control the defense.",
      ],
    },
    {
      heading: "Governing law and disputes",
      paragraphs: [
        "[Governing law and venue to be confirmed by counsel]",
        "Before starting a formal proceeding, each party agrees to contact the other and negotiate in good faith for 30 days.",
      ],
    },
    {
      heading: "Changes to these terms",
      paragraphs: [
        "We may update these terms. We post the new version here with a new effective date and, for material changes, email organization owners at least 14 days before it takes effect. Using the service after that date accepts the new terms. If you do not agree, stop using the service and ask us to delete your organization.",
      ],
    },
    {
      heading: "General",
      paragraphs: [
        `These terms, the Privacy Policy, and any order or enterprise agreement are the entire agreement between us and replace earlier discussions. If a court finds a provision unenforceable, the rest stays in force. Not enforcing a provision is not a waiver of it. You may not assign these terms without our consent; we may assign them to a successor. Notices to us go to ${contactEmail}; notices to you go to the owner email addresses on your organization. You must comply with export and sanctions law when using the service.`,
      ],
    },
    {
      heading: "Contact",
      paragraphs: [
        `${operator}, San Francisco, California. Email ${contactEmail}.`,
        entityPlaceholder,
      ],
    },
  ],
};

export const legalCopy = {
  eyebrow: "Legal",
  effective: "Effective",
  contents: "Contents",
  contactEmail,
  privacy,
  terms,
  /** Signup and onboarding: "By continuing you agree to the Terms of Service and Privacy Policy." */
  agreement: {
    before: "By continuing you agree to the",
    between: "and",
    after: ".",
  },
} as const;
