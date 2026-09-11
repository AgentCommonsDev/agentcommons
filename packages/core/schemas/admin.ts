import {
  policyDefinitionSchema,
  policyKindSchema,
} from "../redaction/policy.js";
import { z } from "zod";
import {
  catalogDescription,
  createListInputSchema,
  decimalIntegerSchema,
  emailSchema,
  harnessSchema,
  identityIdSchema,
  jsonValueSchema,
  keyPermissionsSchema,
  keyToolGroupSchema,
  nonnegativeIntegerSchema,
  nullableTextSchema,
  paginatedOutput,
  paginationSchema,
  parentRelationSchema,
  organizationRoleSchema,
  reasonSchema,
  sessionIdSchema,
  sessionStatusSchema,
  sha256Schema,
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
const installation = (column: string) =>
  catalogDescription("installations", column);
/**
 * One installation as the admin heal view lists it: its control-plane identity, the hook
 * bundle digest of its latest upload and whether that digest matches the bundle this
 * instance serves at `/hook/manifest.json` (§10). `up_to_date` is null when the machine
 * has reported no digest yet or the instance serves no manifest, so a comparison that
 * cannot be made is never reported as behind.
 */
export const installationHealSchema = z.strictObject({
  installation_id: sessionIdSchema.describe(installation("installation_id")),
  hostname: z.string().describe(installation("hostname")),
  os_user: z.string().describe(installation("os_user")),
  platform: z.string().describe(installation("platform")),
  arch: z.string().describe(installation("arch")),
  tools_enabled: z.boolean().describe(installation("tools_enabled")),
  hook_sha256: sha256Schema.nullable().describe(installation("hook_sha256")),
  up_to_date: z
    .boolean()
    .nullable()
    .describe(
      "True when this machine's hook digest matches the served manifest; false when it reports an older digest; null when it has reported no digest or no manifest is served",
    ),
  first_seen_at: utcDateTimeSchema.describe(installation("first_seen_at")),
  last_seen_at: utcDateTimeSchema.describe(installation("last_seen_at")),
});
export const installationHealSortKeys = [
  "hostname",
  "last_seen_at",
  "first_seen_at",
  "up_to_date",
  "tools_enabled",
] as const;
export const installationHealInputSchema = createListInputSchema(
  installationHealSortKeys,
).extend({
  filters: z
    .strictObject({
      hostname: z
        .string()
        .trim()
        .min(1)
        .max(256)
        .optional()
        .describe("Machines whose hostname contains this text (ignoring case)"),
    })
    .default({}),
});
/** The hook bundle this instance serves, that the heal view compares each machine with. */
export const servedManifestSchema = z.strictObject({
  version: z.string().describe("The served bundle version label"),
  sha256: sha256Schema.describe("The served hook.js digest"),
});
/** Bundle-freshness counts over every installation the filters match, whatever the page. */
export const installationHealTotalSchema = z.strictObject({
  installations: nonnegativeIntegerSchema.describe(
    "Installations the filters match across every page",
  ),
  up_to_date: nonnegativeIntegerSchema.describe(
    "Installations whose hook digest matches the served bundle",
  ),
  behind: nonnegativeIntegerSchema.describe(
    "Installations reporting an older hook digest",
  ),
  unknown: nonnegativeIntegerSchema.describe(
    "Installations with no reported digest, or every installation when no bundle is served",
  ),
});
export const installationHealOutputSchema = paginatedOutput(
  installationHealSchema,
).extend({
  manifest: servedManifestSchema
    .nullable()
    .describe(
      "The hook bundle this instance serves at /hook/manifest.json, or null when none is served",
    ),
  total: installationHealTotalSchema.describe(
    "Freshness counts over every matching installation, unchanged by the page window",
  ),
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
/** Where a session's read model stands in `trace_session_control.projection_state` (§5.2, §9.5). */
export const projectionStateSchema = z.enum([
  "queued",
  "waiting_source",
  "published",
  "failed",
]);
const session = (column: string) => catalogDescription("sessions", column);
/**
 * `GET /admin/sessions`: every session the organization holds in control, whatever its
 * publication, visibility or purge state. Each key narrows; every key given must hold.
 */
export const moderationFiltersSchema = z.strictObject({
  user_email: emailSchema
    .optional()
    .describe("Sessions run by this member (exact email)"),
  harness: harnessSchema.optional().describe("Sessions of this coding agent"),
  status: sessionStatusSchema.optional().describe(session("status")),
  visibility: visibilitySchema.optional().describe(session("visibility")),
  purged: z
    .boolean()
    .optional()
    .describe("True: purged sessions only; false: sessions with content"),
  published: z
    .boolean()
    .optional()
    .describe(
      "True: sessions with a published read model; false: sessions still queued, waiting for their transcript or failed",
    ),
  session_id: sessionIdSchema.optional().describe("One session by id"),
  since: utcDateTimeSchema
    .optional()
    .describe("Sessions started at or after this UTC time (inclusive)"),
  until: utcDateTimeSchema
    .optional()
    .describe("Sessions started before this UTC time (exclusive)"),
});
export const moderationInputSchema = createListInputSchema([
  "started_at",
  "last_activity_at",
  "user_email",
  "harness",
  "status",
  "visibility",
  "purged_at",
]).extend({
  filters: moderationFiltersSchema.default({}),
  /** Only sessions without a parent: subagent, fork and spawned runs stay inside their parent. */
  roots_only: z.boolean().default(false),
});
/** One control row with the published title, repository and count when the read model has them. */
export const moderationSessionSchema = z.strictObject({
  session_id: sessionIdSchema.describe(session("session_id")),
  harness: harnessSchema.describe(session("harness")),
  harness_session_id: z.string().describe(session("harness_session_id")),
  /** Null once the member's account no longer exists. */
  user_email: emailSchema.nullable().describe(session("user_email")),
  installation_hostname: z
    .string()
    .nullable()
    .describe(session("installation_hostname")),
  started_at: utcDateTimeSchema.describe(session("started_at")),
  last_activity_at: utcDateTimeSchema.describe(session("last_activity_at")),
  ended_at: utcDateTimeSchema.nullable().describe(session("ended_at")),
  status: sessionStatusSchema.describe(session("status")),
  visibility: visibilitySchema.describe(session("visibility")),
  purged_at: utcDateTimeSchema.nullable().describe(session("purged_at")),
  published: z
    .boolean()
    .describe(
      "True when a read-model revision is published, so the session appears in sessions, search and sql",
    ),
  projection_state: projectionStateSchema.describe(
    "Where the read model stands: queued, waiting_source (the native transcript has not arrived), published or failed",
  ),
  parent_session_id: sessionIdSchema
    .nullable()
    .describe(session("parent_session_id")),
  parent_relation: parentRelationSchema
    .nullable()
    .describe(session("parent_relation")),
  title: nullableTextSchema.describe(
    "Published title; null for a purged or not yet published session",
  ),
  repo_name: nullableTextSchema.describe(
    "Published repository; null for a purged or not yet published session",
  ),
  message_count: nonnegativeIntegerSchema
    .nullable()
    .describe("Published message count; null for a not yet published session"),
});
/** Counts over the whole filtered set of control rows; the page window never changes them. */
export const moderationTotalSchema = z.strictObject({
  sessions: nonnegativeIntegerSchema.describe(
    "Sessions the filters match across every page",
  ),
});
export const moderationOutputSchema = paginatedOutput(
  moderationSessionSchema,
).extend({
  total: moderationTotalSchema.describe(
    "Total over every matching session, computed with the same filters and roots_only as the page",
  ),
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
  /** The member's latest audited dashboard (cookie) request in this organization; null before the first. */
  last_seen_at: utcDateTimeSchema.nullable(),
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
/**
 * What the host's hourly updater last recorded (`/var/lib/agentcommons/update-state`,
 * ADR 0059), read by the API when the file is mounted; null when it is not. Empty values
 * in the file read as null.
 */
export const updaterStateSchema = z.strictObject({
  /** Every timer run records one, whether or not updates are enabled: the updater is alive. */
  last_check: utcDateTimeSchema.nullable(),
  /** The last run that completed its check (up to date, updated, or a held release skipped). */
  last_ok: utcDateTimeSchema.nullable(),
  last_result: z.string().max(100).nullable(),
  last_image: z.string().max(200).nullable(),
  previous_image: z.string().max(200).nullable(),
  updated_at: utcDateTimeSchema.nullable(),
  /** A release that did not come up; held until a newer one is published. */
  failed_image: z.string().max(200).nullable(),
  failed_at: utcDateTimeSchema.nullable(),
  /** Consecutive runs that ended in a failure (pull, start, rollback); zero after a completed check. */
  failures: nonnegativeIntegerSchema,
  /**
   * The release stamps (OCI revision and created labels) of the running image and of the
   * image the configured tag offered at the last pull; the updater installs the pulled one
   * only when it is a later build of another commit, and holds otherwise (§13).
   */
  running_revision: z.string().max(100).nullable(),
  running_created: utcDateTimeSchema.nullable(),
  pulled_revision: z.string().max(100).nullable(),
  pulled_created: utcDateTimeSchema.nullable(),
});
/** The release this server runs and whether its host installs new releases on its own (ADR 0059). */
export const serverStatusSchema = z.strictObject({
  version: z.string().min(1).max(100),
  auto_update: z.boolean(),
  updater: updaterStateSchema.nullable(),
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
  "last_seen_at",
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
      tool_group: keyToolGroupSchema
        .optional()
        .describe(
          "Only keys whose permissions grant this MCP tool group (dashboards, administration)",
        ),
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
