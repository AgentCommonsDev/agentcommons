export const JOB_QUEUES = {
  traceAudit: "trace-audit-projection",
  traceProjection: "trace-projection",
  rescan: "redaction-rescan",
  embedding: "session-embedding",
  embeddingCatchup: "organization-embedding-catchup",
  billingMeter: "billing-meter-delivery",
  welcome: "welcome-email",
  maintenance: "maintenance",
  dashboardPrerender: "dashboard-prerender",
} as const;
