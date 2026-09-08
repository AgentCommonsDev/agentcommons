import { policyDefinitionSchema } from "../redaction/policy.js";
import { z } from "zod";
import {
  createListInputSchema,
  decimalIntegerSchema,
  emailSchema,
  identityIdSchema,
  jsonValueSchema,
  keyPermissionsSchema,
  nonnegativeIntegerSchema,
  opaqueCursorSchema,
  paginatedOutput,
  paginationSchema,
  organizationRoleSchema,
  reasonSchema,
  sessionIdSchema,
  transportSchema,
  utcDateTimeSchema,
  visibilitySchema,
} from "./common.js";

export const reasonInputSchema = z.strictObject({ reason: reasonSchema });

export const visibilityInputSchema = z.strictObject({
  session_id: sessionIdSchema,
  visibility: visibilitySchema,
  reason: reasonSchema,
});
export const installationToolsInputSchema = reasonInputSchema.extend({
  enabled: z.boolean(),
});
export const installationToolsOutputSchema = z.strictObject({
  installation_id: sessionIdSchema,
  tools_enabled: z.boolean(),
});
export const purgeInputSchema = z.strictObject({
  session_id: sessionIdSchema,
  reason: reasonSchema,
});
export const mutationOutputSchema = z.strictObject({
  id: identityIdSchema,
  updated: z.boolean(),
});
export const purgeOutputSchema = mutationOutputSchema.extend({
  manifest: z.strictObject({
    deleted: z.strictObject({
      raw_records: nonnegativeIntegerSchema,
      messages: nonnegativeIntegerSchema,
      session_files: nonnegativeIntegerSchema,
      message_chunks: nonnegativeIntegerSchema,
      session_embeddings: nonnegativeIntegerSchema,
      redaction_events: nonnegativeIntegerSchema,
    }),
    nulled_fields: z.array(z.string()),
    reset_fields: z.array(z.string()),
    retained: z.array(z.string()),
  }),
});
export const auditFiltersSchema = z.strictObject({
  user_id: identityIdSchema.optional(),
  api_key_id: identityIdSchema.optional(),
  request_id: identityIdSchema.optional(),
  resource_id: identityIdSchema.optional(),
  action: z.string().min(1).optional(),
  transport: transportSchema.optional(),
  status_code: z.number().int().min(100).max(599).optional(),
  since: utcDateTimeSchema.optional(),
  until: utcDateTimeSchema.optional(),
});
export const auditInputSchema = paginationSchema.extend({
  filters: auditFiltersSchema.default({}),
});
export const auditListInputSchema = createListInputSchema([
  "ts",
  "action",
  "user_id",
  "status_code",
  "duration_ms",
  "transport",
  "request_id",
]).extend({ filters: auditFiltersSchema.default({}) });
export const auditEventSchema = z.strictObject({
  id: sessionIdSchema,
  organization_id: identityIdSchema,
  ts: utcDateTimeSchema,
  request_id: z.string(),
  user_id: identityIdSchema.nullable(),
  api_key_id: identityIdSchema.nullable(),
  installation_id: sessionIdSchema.nullable(),
  auth_method: z.string(),
  ip: z.string(),
  user_agent: z.string().nullable(),
  transport: transportSchema,
  action: z.string(),
  resource_type: z.string().nullable(),
  resource_ids: z.array(z.string()),
  status_code: z.number().int().min(100).max(599),
  duration_ms: nonnegativeIntegerSchema,
  detail: jsonValueSchema,
});
export const auditOutputSchema = z.strictObject({
  items: z.array(auditEventSchema),
  cursor: opaqueCursorSchema,
});

export const redactionPolicyInputSchema = policyDefinitionSchema;
export const redactionPolicySchema = z.strictObject({
  id: sessionIdSchema,
  organization_id: identityIdSchema,
  name: z.string(),
  kind: z.enum(["REGEX", "SECRETLINT_RULE"]),
  pattern: z.string().nullable(),
  flags: z.string().nullable(),
  rule_id: z.string().nullable(),
  options: jsonValueSchema.nullable(),
  replacement: z.string(),
  enabled: z.boolean(),
  builtin: z.boolean(),
  created_by_user_id: identityIdSchema.nullable(),
  created_at: utcDateTimeSchema,
  updated_at: utcDateTimeSchema,
});
export const redactionTestInputSchema = z.strictObject({ text: z.string() });
export const redactionTestOutputSchema = z.strictObject({
  text: z.string(),
  matches: z.array(
    z.strictObject({
      policy_id: identityIdSchema,
      count: nonnegativeIntegerSchema,
    }),
  ),
});
export const redactionRescanInputSchema = z.strictObject({
  policyIds: z.array(sessionIdSchema).min(1).optional(),
  since: utcDateTimeSchema.optional(),
  reason: reasonSchema,
});
export const jobOutputSchema = z.strictObject({ job_id: identityIdSchema });
export const jobProgressSchema = jobOutputSchema.extend({
  state: z.enum(["queued", "running", "completed", "failed"]),
  total_sessions: nonnegativeIntegerSchema,
  processed_sessions: nonnegativeIntegerSchema,
  redaction_count: nonnegativeIntegerSchema,
  error: z.string().nullable(),
});

export const memberAddInputSchema = z.strictObject({
  emails: z.array(emailSchema).min(1).max(100),
  role: organizationRoleSchema,
});
export const memberAddOutputSchema = z.strictObject({
  results: z.array(
    z.strictObject({
      email: emailSchema,
      status: z.enum(["added", "existing", "error"]),
      user_id: identityIdSchema.nullable(),
      setup_url: z.url().nullable(),
      error: z.string().nullable(),
    }),
  ),
});
export const memberRoleInputSchema = z.strictObject({
  role: organizationRoleSchema,
  reason: reasonSchema,
});
export const memberSuspensionInputSchema = z.strictObject({
  suspended: z.boolean(),
  reason: reasonSchema,
});
export const memberSchema = z.strictObject({
  id: identityIdSchema,
  user_id: identityIdSchema,
  organization_id: identityIdSchema,
  email: emailSchema,
  name: z.string(),
  role: organizationRoleSchema,
  suspended: z.boolean(),
  created_at: utcDateTimeSchema,
});
export const keyCreateInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(128),
  permissions: keyPermissionsSchema,
  expires_in: z.number().int().min(1).max(31_536_000).optional(),
});
export const keySchema = z.strictObject({
  id: identityIdSchema,
  organization_id: identityIdSchema,
  user_id: identityIdSchema,
  name: z.string().nullable(),
  prefix: z.string().nullable(),
  permissions: keyPermissionsSchema,
  enabled: z.boolean(),
  created_at: utcDateTimeSchema,
  expires_at: utcDateTimeSchema.nullable(),
  last_used_at: utcDateTimeSchema.nullable(),
});
export const keyCreateOutputSchema = z.strictObject({
  key: z.string().startsWith("ac_"),
  metadata: keySchema,
});
export const statusOutputSchema = z.strictObject({
  ingest_per_day: z.array(
    z.strictObject({ date: z.iso.date(), count: nonnegativeIntegerSchema }),
  ),
  redaction_hits: z.array(
    z.strictObject({
      policy_id: identityIdSchema,
      count: nonnegativeIntegerSchema,
    }),
  ),
  failures: z.array(
    z.strictObject({ date: z.iso.date(), count: nonnegativeIntegerSchema }),
  ),
  queue_depth: nonnegativeIntegerSchema,
  embedding_backlog: nonnegativeIntegerSchema,
  embedding_daily_tokens: decimalIntegerSchema,
  embedding_daily_cost: z.string(),
});
export type RedactionPolicyInput = z.infer<typeof redactionPolicyInputSchema>;
export type AuditInput = z.infer<typeof auditInputSchema>;
export type AuditOutput = z.infer<typeof auditOutputSchema>;
export type MemberAddInput = z.infer<typeof memberAddInputSchema>;

export const membersInputSchema = createListInputSchema([
  "email",
  "name",
  "role",
  "suspended",
  "created_at",
]).extend({
  filters: z
    .strictObject({
      email: emailSchema.optional(),
      role: organizationRoleSchema.optional(),
      suspended: z.boolean().optional(),
    })
    .default({}),
});
export const membersOutputSchema = paginatedOutput(memberSchema);
export const keysInputSchema = createListInputSchema([
  "name",
  "user_id",
  "created_at",
  "expires_at",
  "last_used_at",
  "enabled",
]).extend({
  filters: z
    .strictObject({
      user_id: identityIdSchema.optional(),
      enabled: z.boolean().optional(),
    })
    .default({}),
});
export const keysOutputSchema = paginatedOutput(keySchema);
export const redactionPoliciesInputSchema = createListInputSchema([
  "name",
  "kind",
  "enabled",
  "builtin",
  "created_at",
  "updated_at",
]).extend({
  filters: z
    .strictObject({
      name: z.string().trim().min(1).optional(),
      kind: z.enum(["REGEX", "SECRETLINT_RULE"]).optional(),
      enabled: z.boolean().optional(),
      builtin: z.boolean().optional(),
    })
    .default({}),
});
export const redactionPoliciesOutputSchema = paginatedOutput(
  redactionPolicySchema,
);
