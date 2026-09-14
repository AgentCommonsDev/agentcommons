import { z } from "zod";
import * as schema from "@agentcommons/core/schemas";
import type { ServiceContext, ServiceResult } from "../services/context.js";
import type { Services } from "./services.js";

/**
 * Optional route groups. The build-time OpenAPI artifact registers every group so the
 * dashboard client is complete; a running instance registers only the groups its mode and
 * configuration activate, so the live reference and the MCP catalog list active routes
 * only (§7.6, §8.2, §11).
 */
export interface RouteFeatures {
  /** `/sessions/:id/similar`: operator embeddings flag. */
  embeddings: boolean;
  /** Onboarding, organization creation and billing usage/checkout/portal: `INSTANCE_MODE=saas`. */
  saas: boolean;
  /** `POST /admin/domains`: Google is the sole login provider and signup is not closed. */
  domainEnrollment: boolean;
}
/** Params and query are objects whose fields merge into one tool input. */
export type RouteObject = z.ZodObject<z.core.$ZodShape>;
/**
 * One `/admin` route as data both adapters read (ADR 0072): REST registers it with these
 * schemas and summary, and the MCP catalog derives the `administration` tool group from the
 * same declarations, so a capability exists once and is exposed twice.
 */
export interface AdminRoute<
  P extends RouteObject = RouteObject,
  Q extends RouteObject = RouteObject,
  B extends z.ZodType = z.ZodType,
> {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: `/admin${string}`;
  summary: string;
  params?: P;
  query?: Q;
  /**
   * Declared for every method but GET; the REST route accepts no body otherwise. An
   * object, or a discriminated union of objects (one tool input variant per option).
   */
  body?: B;
  output: z.ZodType;
  /** `format=csv` answers the `{ items, cursor }` page as one CSV page (§7.6). */
  csv?: true;
  /** The route and its tool exist only while this optional group is active. */
  feature?: keyof RouteFeatures;
  /**
   * The MCP name (§8.2): `admin_<resource>_<verb>` for a tool derived from this route, or
   * the name of a standing admin tool that already covers the capability, so nothing is
   * exposed under two names.
   */
  tool: string;
  /** Tool annotations: a read changes nothing; a destructive call removes data for good. */
  readOnly: boolean;
  destructive?: true;
  execute(
    services: Services,
    context: ServiceContext,
    data: { params: z.output<P>; query: z.output<Q>; body: z.output<B> },
  ): Promise<ServiceResult<unknown>>;
}
type Empty = typeof schema.emptySchema;
/** Types one route's data from its schemas; the table holds the erased form. */
const adminRoute = <
  P extends RouteObject = Empty,
  Q extends RouteObject = Empty,
  B extends z.ZodType = Empty,
>(
  route: AdminRoute<P, Q, B>,
): AdminRoute => route;
const withId = <T>(id: string, body: T) => ({ ...body, session_id: id });

/** Every `/admin` route in registration order (§7.5, §9); paths are relative to `/api/v1`. */
export const adminRoutes: readonly AdminRoute[] = [
  adminRoute({
    method: "GET",
    path: "/admin/domains",
    summary: "List Google SSO domain access",
    query: schema.domainsInputSchema,
    output: schema.domainsOutputSchema,
    tool: "admin_domains_list",
    readOnly: true,
    execute: (services, ctx, input) => services.auth.domains(ctx, input.query),
  }),
  adminRoute({
    method: "POST",
    path: "/admin/domains",
    summary: "Allow a Google email domain to join this organization",
    body: schema.domainInputSchema,
    output: schema.domainOutputSchema,
    feature: "domainEnrollment",
    tool: "admin_domain_allow",
    readOnly: false,
    execute: (services, ctx, input) => services.auth.domain(ctx, input.body),
  }),
  adminRoute({
    method: "GET",
    path: "/admin/users",
    summary: "List organization members",
    query: schema.membersInputSchema,
    output: schema.membersOutputSchema,
    csv: true,
    tool: "admin_members_list",
    readOnly: true,
    execute: (services, ctx, input) => services.members.list(ctx, input.query),
  }),
  adminRoute({
    method: "POST",
    path: "/admin/users",
    summary: "Add people to the organization",
    body: schema.memberAddInputSchema,
    output: schema.memberAddOutputSchema,
    tool: "admin_members_add",
    readOnly: false,
    execute: (services, ctx, input) => services.members.add(ctx, input.body),
  }),
  adminRoute({
    method: "GET",
    path: "/admin/users/:id",
    summary: "Read one organization member",
    params: schema.identityParamsSchema,
    output: schema.memberSchema,
    tool: "admin_member_get",
    readOnly: true,
    execute: (services, ctx, input) =>
      services.members.get(ctx, input.params.id),
  }),
  adminRoute({
    method: "POST",
    path: "/admin/users/password-setup",
    summary: "Issue initial password setup",
    body: schema.passwordSetupInputSchema,
    output: schema.passwordSetupOutputSchema,
    tool: "admin_member_password_setup",
    readOnly: false,
    execute: (services, ctx, input) =>
      services.members.passwordSetup(ctx, input.body.user_id),
  }),
  adminRoute({
    method: "PATCH",
    path: "/admin/users/:id/role",
    summary: "Change an organization member role",
    params: schema.identityParamsSchema,
    body: schema.memberRoleInputSchema,
    output: schema.mutationOutputSchema,
    tool: "admin_member_set_role",
    readOnly: false,
    execute: (services, ctx, input) =>
      services.members.role(ctx, input.params.id, input.body),
  }),
  adminRoute({
    method: "PATCH",
    path: "/admin/users/:id/suspension",
    summary: "Suspend or restore a membership",
    params: schema.identityParamsSchema,
    body: schema.memberSuspensionInputSchema,
    output: schema.mutationOutputSchema,
    tool: "admin_member_set_suspension",
    readOnly: false,
    execute: (services, ctx, input) =>
      services.members.suspend(ctx, input.params.id, input.body),
  }),
  adminRoute({
    method: "DELETE",
    path: "/admin/users/:id",
    summary: "Remove an organization member",
    params: schema.identityParamsSchema,
    body: schema.reasonInputSchema,
    output: schema.mutationOutputSchema,
    tool: "admin_member_remove",
    readOnly: false,
    destructive: true,
    execute: (services, ctx, input) =>
      services.members.remove(ctx, input.params.id, input.body),
  }),
  adminRoute({
    method: "GET",
    path: "/admin/keys",
    summary: "List organization API keys",
    query: schema.keysInputSchema,
    output: schema.keysOutputSchema,
    csv: true,
    tool: "admin_keys_list",
    readOnly: true,
    execute: (services, ctx, input) =>
      services.auth.listKeys(ctx, input.query, false),
  }),
  adminRoute({
    method: "DELETE",
    path: "/admin/keys/:id",
    summary: "Revoke an organization API key",
    params: schema.identityParamsSchema,
    body: schema.reasonInputSchema,
    output: schema.mutationOutputSchema,
    tool: "admin_key_revoke",
    readOnly: false,
    destructive: true,
    execute: (services, ctx, input) =>
      services.auth.revokeKey(ctx, input.params.id, input.body, false),
  }),
  adminRoute({
    method: "GET",
    path: "/admin/sessions",
    summary: "List every session of the organization for moderation",
    query: schema.moderationInputSchema,
    output: schema.moderationOutputSchema,
    csv: true,
    tool: "admin_sessions_list",
    readOnly: true,
    execute: (services, ctx, input) =>
      services.admin.sessions(ctx, input.query),
  }),
  adminRoute({
    method: "POST",
    path: "/admin/sessions/:id/visibility",
    summary: "Change session visibility",
    params: schema.uuidParamsSchema,
    body: schema.visibilityInputSchema.omit({ session_id: true }),
    output: schema.mutationOutputSchema,
    tool: "set_visibility",
    readOnly: false,
    execute: (services, ctx, input) =>
      services.admin.setVisibility(ctx, withId(input.params.id, input.body)),
  }),
  adminRoute({
    method: "GET",
    path: "/admin/installations",
    summary:
      "List installations with hook bundle heal status against the served manifest",
    query: schema.installationHealInputSchema,
    output: schema.installationHealOutputSchema,
    csv: true,
    tool: "admin_installations_list",
    readOnly: true,
    execute: (services, ctx, input) =>
      services.admin.installations(ctx, input.query),
  }),
  adminRoute({
    method: "POST",
    path: "/admin/installations/:id/tools",
    summary: "Enable or disable installation MCP tools",
    params: schema.uuidParamsSchema,
    body: schema.enabledInputSchema,
    output: schema.installationToolsOutputSchema,
    tool: "admin_installation_set_tools",
    readOnly: false,
    execute: (services, ctx, input) =>
      services.admin.setInstallationTools(ctx, input.params.id, input.body),
  }),
  adminRoute({
    method: "POST",
    path: "/admin/sessions/:id/purge",
    summary: "Purge session contents",
    params: schema.uuidParamsSchema,
    body: schema.purgeInputSchema.omit({ session_id: true }),
    output: schema.purgeOutputSchema,
    tool: "purge",
    readOnly: false,
    destructive: true,
    execute: (services, ctx, input) =>
      services.admin.purge(ctx, withId(input.params.id, input.body)),
  }),
  adminRoute({
    method: "GET",
    path: "/admin/audit",
    summary: "List organization audit events",
    query: schema.auditListInputSchema,
    output: schema.auditOutputSchema,
    csv: true,
    tool: "audit",
    readOnly: true,
    execute: (services, ctx, input) =>
      services.admin.auditLog(ctx, input.query),
  }),
  adminRoute({
    method: "GET",
    path: "/admin/metrics/:group",
    summary: "Read filtered organization metrics",
    params: z.strictObject({ group: schema.metricsGroupSchema }),
    query: schema.metricsInputSchema,
    output: schema.metricsOutputSchema,
    csv: true,
    tool: "admin_metrics_list",
    readOnly: true,
    execute: (services, ctx, input) =>
      services.admin.metrics(ctx, input.params.group, input.query),
  }),
  adminRoute({
    method: "GET",
    path: "/admin/status",
    summary: "Read organization ingestion status",
    output: schema.statusOutputSchema,
    tool: "status",
    readOnly: true,
    execute: (services, ctx) => services.admin.status(ctx),
  }),
  adminRoute({
    method: "GET",
    path: "/admin/redaction/policies",
    summary: "List redaction policies",
    query: schema.redactionPoliciesInputSchema,
    output: schema.redactionPoliciesOutputSchema,
    csv: true,
    tool: "admin_policies_list",
    readOnly: true,
    execute: (services, ctx, input) => services.policies.list(ctx, input.query),
  }),
  adminRoute({
    method: "POST",
    path: "/admin/redaction/policies",
    summary: "Create a redaction policy",
    body: schema.redactionPolicyInputSchema,
    output: schema.redactionPolicySchema,
    tool: "admin_policy_create",
    readOnly: false,
    execute: (services, ctx, input) =>
      services.policies.save(ctx, null, input.body),
  }),
  adminRoute({
    method: "PATCH",
    path: "/admin/redaction/policies/:id",
    summary: "Update a redaction policy",
    params: schema.uuidParamsSchema,
    body: schema.redactionPolicyInputSchema,
    output: schema.redactionPolicySchema,
    tool: "admin_policy_update",
    readOnly: false,
    execute: (services, ctx, input) =>
      services.policies.save(ctx, input.params.id, input.body),
  }),
  adminRoute({
    method: "DELETE",
    path: "/admin/redaction/policies/:id",
    summary: "Remove a redaction policy",
    params: schema.uuidParamsSchema,
    body: schema.reasonInputSchema,
    output: schema.mutationOutputSchema,
    tool: "admin_policy_remove",
    readOnly: false,
    destructive: true,
    execute: (services, ctx, input) =>
      services.policies.remove(ctx, input.params.id, input.body),
  }),
  adminRoute({
    method: "POST",
    path: "/admin/redaction/test",
    summary: "Test organization redaction policies",
    body: schema.redactionTestInputSchema,
    output: schema.redactionTestOutputSchema,
    tool: "admin_redaction_test",
    readOnly: true,
    execute: (services, ctx, input) => services.policies.test(ctx, input.body),
  }),
  adminRoute({
    method: "GET",
    path: "/admin/redaction/summary",
    summary:
      "Read the organization's redaction totals, recent windows, per-policy counts and run tally",
    output: schema.redactionSummaryOutputSchema,
    tool: "admin_redaction_summary",
    readOnly: true,
    execute: (services, ctx) => services.policies.summary(ctx),
  }),
  adminRoute({
    method: "GET",
    path: "/admin/redaction/hits",
    summary:
      "List where redactions landed: session, message position, policy, source and time",
    query: schema.redactionHitsInputSchema,
    output: schema.redactionHitsOutputSchema,
    csv: true,
    tool: "admin_redaction_hits_list",
    readOnly: true,
    execute: (services, ctx, input) => services.policies.hits(ctx, input.query),
  }),
  adminRoute({
    method: "GET",
    path: "/admin/redaction/rescan",
    summary:
      "List redaction rescan runs with progress and the sessions each changed",
    query: schema.redactionRunsInputSchema,
    output: schema.redactionRunsOutputSchema,
    csv: true,
    tool: "admin_rescans_list",
    readOnly: true,
    execute: (services, ctx, input) => services.policies.runs(ctx, input.query),
  }),
  adminRoute({
    method: "GET",
    path: "/admin/redaction/rescan/:id",
    summary: "Read redaction rescan progress",
    params: schema.identityParamsSchema,
    output: schema.jobProgressSchema,
    tool: "admin_rescan_get",
    readOnly: true,
    execute: (services, ctx, input) =>
      services.jobs.progress(ctx, input.params.id),
  }),
  adminRoute({
    method: "GET",
    path: "/admin/redaction/rescan/:id/sessions",
    summary: "List the sessions a redaction rescan run changed, with counts",
    params: schema.identityParamsSchema,
    query: schema.redactionRunSessionsInputSchema,
    output: schema.redactionRunSessionsOutputSchema,
    csv: true,
    tool: "admin_rescan_sessions_list",
    readOnly: true,
    execute: (services, ctx, input) =>
      services.policies.runSessions(ctx, input.params.id, input.query),
  }),
  adminRoute({
    method: "POST",
    path: "/admin/redaction/rescan",
    summary: "Rescan existing organization records",
    body: schema.redactionRescanInputSchema,
    output: schema.jobOutputSchema,
    tool: "admin_rescan_start",
    readOnly: false,
    execute: (services, ctx, input) => services.admin.rescan(ctx, input.body),
  }),
  adminRoute({
    method: "GET",
    path: "/admin/tool-policy",
    summary: "Read the organization's tool and command policy",
    output: schema.toolPolicyDocumentSchema,
    tool: "admin_tool_policy_get",
    readOnly: true,
    execute: (services, ctx) => services.toolPolicy.get(ctx),
  }),
  adminRoute({
    method: "PUT",
    path: "/admin/tool-policy",
    summary: "Replace the organization's tool and command policy",
    body: schema.toolPolicyReplaceInputSchema,
    output: schema.toolPolicyDocumentSchema,
    tool: "admin_tool_policy_set",
    readOnly: false,
    execute: (services, ctx, input) =>
      services.toolPolicy.replace(ctx, input.body),
  }),
  adminRoute({
    method: "GET",
    path: "/admin/tool-policy/violations",
    summary:
      "List recorded tool-policy violations: session, rule, decision, severity and time",
    query: schema.toolPolicyViolationsInputSchema,
    output: schema.toolPolicyViolationsOutputSchema,
    csv: true,
    tool: "admin_tool_policy_violations_list",
    readOnly: true,
    execute: (services, ctx, input) =>
      services.toolPolicy.violations(ctx, input.query),
  }),
];
/** The admin routes a running instance registers and lists: every one whose feature is active. */
export function activeAdminRoutes(features: RouteFeatures): AdminRoute[] {
  return adminRoutes.filter(
    (route) => route.feature === undefined || features[route.feature],
  );
}
