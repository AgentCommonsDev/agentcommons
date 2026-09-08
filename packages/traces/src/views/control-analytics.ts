/** Narrow operational metadata; no native identity credentials reach ClickHouse. */
export const controlAnalyticsTables: Record<string, Record<string, string>> = {
  audit_retention: { id: "Int32", retained_after: "DateTime64(6, 'UTC')" },
  metrics_health: {
    organization_id: "String",
    session_id: "UUID",
    authorization_blocked: "Int32",
  },
  metrics_members: { organization_id: "String", member_count: "Int64" },
};
