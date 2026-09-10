import {
  policyDefinitionSchema,
  policyKindSchema,
} from "../redaction/policy.js";
import { z } from "zod";
import {
  createListInputSchema,
  decimalIntegerSchema,
  emailSchema,
  identityIdSchema,
  jsonValueSchema,
  keyPermissionsSchema,
  nonnegativeIntegerSchema,
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
/** Toggle a per-installation or per-organization capability with an audit reason. */
export const enabledInputSchema = reasonInputSchema.extend({
  enabled: z.boolean(),
});
const httpStatusSchema = z.number().int().min(100).max(599);
/** An organization API key secret as returned once on creation or reveal. */
const apiKeySecretSchema = z.string().startsWith("ac_");
const policyHitSchema = z.strictObject({
  policy_id: identityIdSchema,
  count: nonnegativeIntegerSchema,
});
const dailyCountSchema = z.strictObject({
  date: z.iso.date(),
  count: nonnegativeIntegerSchema,
});

export const visibilityInputSchema = z.strictObject({
  session_id: sessionIdSchema,
  visibility: visibilitySchema,
  ...reasonInputSchema.shape,
});
export const installationToolsOutputSchema = z.strictObject({
  installation_id: sessionIdSchema,
  tools_enabled: z.boolean(),
});
export const purgeInputSchema = z.strictObject({
  session_id: sessionIdSchema,
  ...reasonInputSchema.shape,
});
export const mutationOutputSchema = z.strictObject({
  id: identityIdSchema,
  updated: z.boolean(),
});
export const purgeOutputSchema = mutationOutputSchema.extend({
  cleanup: z.enum(["queued", "completed"]),
  manifest: z.strictObject({
    deleted: z.strictObject({
      raw_records: nonnegativeIntegerSchema.nullable(),
      messages: nonnegativeIntegerSchema.nullable(),
      session_files: nonnegativeIntegerSchema.nullable(),
      message_chunks: nonnegativeIntegerSchema.nullable(),
      session_embeddings: nonnegativeIntegerSchema.nullable(),
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
  status_code: httpStatusSchema.optional(),
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
  /** The acting user's email at read time, so admins never have to decode ids. */
  user_email: emailSchema.nullable(),
  api_key_id: identityIdSchema.nullable(),
  installation_id: sessionIdSchema.nullable(),
  auth_method: z.string(),
  ip: z.string(),
  user_agent: z.string().nullable(),
  transport: transportSchema,
  action: z.string(),
  resource_type: z.string().nullable(),
  resource_ids: z.array(z.string()),
  status_code: httpStatusSchema,
  duration_ms: nonnegativeIntegerSchema,
  detail: jsonValueSchema,
});
export const auditOutputSchema = paginatedOutput(auditEventSchema);

export const redactionPolicyInputSchema = policyDefinitionSchema;
export const redactionPolicySchema = z.strictObject({
  id: sessionIdSchema,
  organization_id: identityIdSchema,
  name: z.string(),
  kind: policyKindSchema,
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
  matches: z.array(policyHitSchema),
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
  user_email: emailSchema.nullable(),
  user_name: z.string().nullable(),
  name: z.string().nullable(),
  prefix: z.string().nullable(),
  permissions: keyPermissionsSchema,
  enabled: z.boolean(),
  created_at: utcDateTimeSchema,
  expires_at: utcDateTimeSchema.nullable(),
  last_used_at: utcDateTimeSchema.nullable(),
});
export const keyCreateOutputSchema = z.strictObject({
  key: apiKeySecretSchema,
  metadata: keySchema,
});
/** `POST /me/keys/:id/reveal`: the caller's own active key, decrypted from its stored copy. */
export const apiKeyRevealOutputSchema = z.strictObject({
  key: apiKeySecretSchema,
});
/** The release this server runs and whether its host installs new releases on its own (ADR 0059). */
export const serverStatusSchema = z.strictObject({
  version: z.string().min(1).max(100),
  auto_update: z.boolean(),
});
export const statusOutputSchema = z.strictObject({
  server: serverStatusSchema,
  projection: z.strictObject({
    queued_sessions: nonnegativeIntegerSchema,
    outbox_batches: nonnegativeIntegerSchema,
    oldest_accepted_at: utcDateTimeSchema.nullable(),
    failed_sessions: nonnegativeIntegerSchema,
    waiting_source_sessions: nonnegativeIntegerSchema,
    pending_audit_events: nonnegativeIntegerSchema,
  }),
  ingest_per_day: z.array(dailyCountSchema),
  redaction_hits: z.array(policyHitSchema),
  failures: z.array(dailyCountSchema),
  queue_depth: nonnegativeIntegerSchema,
  embedding_backlog: nonnegativeIntegerSchema,
  embedding_daily_tokens: decimalIntegerSchema,
  embedding_daily_cost: z.string(),
});

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
      kind: policyKindSchema.optional(),
      enabled: z.boolean().optional(),
      builtin: z.boolean().optional(),
    })
    .default({}),
});
export const redactionPoliciesOutputSchema = paginatedOutput(
  redactionPolicySchema,
);
