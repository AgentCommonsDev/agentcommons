/** Strings for the Usage and billing page. Owned by the billing feature. */
export const billingCopy = {
  title: "Usage and billing",
  description:
    "Your organization's captured records and embedding usage for the current billing period.",
  plan: "Current plan",
  period: "UTC usage period",
  periodEnd: "Next reset",
  used: "Captured records",
  limit: "Monthly allowance",
  remaining: "Included records remaining",
  unmetered: "Unmetered",
  upgrade: "Upgrade to Pro",
  portal: "Manage billing",
  planChoice: "Paid plan",
  changePlan: "Change plan",
  overage: "Additional captured records",
  embedded: "Indexed messages",
  captureEstimate: "Estimated capture usage charge",
  embeddingEstimate: "Estimated embedding usage charge",
  estimates:
    "Usage estimates exclude monthly plan fees and taxes. Your billing invoice is authoritative.",
  meteringPending: "Usage awaiting billing delivery",
  reconciliation: "Usage requiring operator review",

  opening: "Opening billing…",
  ownerOnly: "An organization owner can manage the plan.",
  cap: "This month's free record allowance has been reached. Your team's saved history remains searchable.",
  pending: "Pending captures retry after an upgrade or the next monthly reset.",
  returnHint: "Your plan updates after payment is confirmed.",
  progress: "Included records used",
} as const;
