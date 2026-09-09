import { once } from "node:events";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as schema from "@agentcommons/core/schemas";
import { formatCsv } from "@agentcommons/core/format";
import type { ServiceContext, ServiceResult } from "../services/context.js";
import { hijackRaw, requestContext } from "./context.js";
import { requireServices, type Services } from "./services.js";

const empty = schema.emptySchema;
// Fastify represents an omitted DELETE body as null; GET arrives as undefined.
const noBody = empty.nullish();
const csvFormatSchema = z.looseObject({ format: z.literal("csv") });
const pageSchema = z.looseObject({
  items: z.array(z.unknown()),
  cursor: z.string().nullable(),
});
/**
 * Optional route groups. The build-time OpenAPI artifact registers every group so the
 * dashboard client is complete; a running instance registers only the groups its mode and
 * configuration activate, so the live reference lists active routes only (§7.6, §11).
 */
interface RouteFeatures {
  /** `/sessions/:id/similar`: operator embeddings flag. */
  embeddings: boolean;
  /** Onboarding, organization creation and billing usage/checkout/portal: `INSTANCE_MODE=saas`. */
  saas: boolean;
  /** `POST /admin/domains`: Google is the sole login provider and signup is not closed. */
  domainEnrollment: boolean;
}
export function registerApiRoutes(
  app: FastifyInstance,
  services: Services | undefined,
  features: RouteFeatures,
): void {
  const streams = new Set<AbortController>();
  app.addHook("preClose", (done) => {
    for (const stream of streams) stream.abort();
    done();
  });
  const runtime = (): Services => requireServices(services);
  function route<B extends z.ZodType, Q extends z.ZodType, P extends z.ZodType>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    summary: string,
    contract: {
      body: B;
      query: Q;
      params: P;
      output: z.ZodType;
      status?: number;
      csv?: boolean;
      /** Rate-limit category when the route is not an ordinary read. */
      rate?: "ingest" | "sql";
    },
    execute: (
      context: ServiceContext,
      data: { body: z.output<B>; query: z.output<Q>; params: z.output<P> },
    ) => Promise<ServiceResult<unknown>>,
  ) {
    app.route({
      method,
      url: `/api/v1${path}`,
      config: { protected: true, rate: contract.rate ?? "read" },
      schema: {
        summary,
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        operationId: `${method.toLowerCase()}${path.replaceAll(/[^a-z0-9]+/gi, "_")}`,
        params: contract.params,
        querystring: contract.query,
        ...(method !== "GET" ? { body: contract.body } : {}),
        response: {
          [contract.status ?? 200]: contract.csv
            ? {
                content: {
                  "application/json": { schema: contract.output },
                  "text/csv": { schema: z.string() },
                },
              }
            : contract.output,
          "4xx": schema.errorSchema,
          "5xx": schema.errorSchema,
        },
      },
      handler: async (request, reply) => {
        const query = contract.query.parse(request.query);
        const value = await execute(requestContext(request), {
          body: contract.body.parse(request.body),
          query,
          params: contract.params.parse(request.params),
        });
        reply.code(contract.status ?? 200);
        if (contract.csv && csvFormatSchema.safeParse(query).success) {
          const page = pageSchema.parse(value.result);
          if (page.cursor) reply.header("X-Next-Cursor", page.cursor);
          return reply
            .type("text/csv; charset=utf-8")
            .send(formatCsv(page.items));
        }
        return reply.send(value.result);
      },
    });
  }
  const read = { body: noBody, query: empty, params: empty };
  route(
    "GET",
    "/dashboards",
    "List organization dashboards, the definition schema and tile templates",
    { ...read, output: schema.dashboardListOutputSchema },
    (ctx) => runtime().dashboards.list(ctx),
  );
  route(
    "POST",
    "/dashboards",
    "Create or update a dashboard",
    {
      ...read,
      body: schema.dashboardSaveInputSchema,
      output: schema.dashboardSchema,
    },
    (ctx, input) => runtime().dashboards.save(ctx, input.body),
  );
  route(
    "POST",
    "/dashboards/render",
    "Run the queries of a dashboard with variable values",
    {
      ...read,
      body: schema.dashboardRenderInputSchema,
      output: schema.dashboardRenderOutputSchema,
    },
    (ctx, input) => runtime().dashboards.render(ctx, input.body),
  );
  route(
    "GET",
    "/dashboards/:id",
    "Read a dashboard and its definition",
    {
      ...read,
      params: schema.uuidParamsSchema,
      output: schema.dashboardSchema,
    },
    (ctx, input) => runtime().dashboards.get(ctx, input.params),
  );
  route(
    "DELETE",
    "/dashboards/:id",
    "Delete a dashboard",
    {
      ...read,
      params: schema.uuidParamsSchema,
      output: schema.dashboardDeleteOutputSchema,
    },
    (ctx, input) => runtime().dashboards.delete(ctx, input.params),
  );
  route(
    "POST",
    "/dashboards/:id/default",
    "Make a dashboard the organization default for Home",
    {
      ...read,
      body: empty,
      params: schema.uuidParamsSchema,
      output: schema.dashboardDefaultOutputSchema,
    },
    (ctx, input) => runtime().dashboards.setDefault(ctx, input.params),
  );
  route(
    "GET",
    "/organization/embeddings",
    "Read organization embedding configuration and progress",
    { ...read, output: schema.organizationEmbeddingsOutputSchema },
    (ctx) => runtime().organizationEmbeddings.get(ctx),
  );
  route(
    "PATCH",
    "/organization/embeddings",
    "Enable or disable embeddings for this organization",
    {
      ...read,
      body: schema.organizationEmbeddingsInputSchema,
      output: schema.organizationEmbeddingsOutputSchema,
    },
    (ctx, input) => runtime().organizationEmbeddings.set(ctx, input.body),
  );
  if (features.saas) {
    route(
      "GET",
      "/billing",
      "Read the organization's monthly session usage",
      {
        ...read,
        output: schema.billingUsageSchema,
      },
      (ctx) => runtime().billing.usage(ctx),
    );
    route(
      "POST",
      "/billing/checkout",
      "Open Pro checkout for the current organization",
      {
        ...read,
        body: schema.billingCheckoutSchema,
        output: schema.billingRedirectSchema,
      },
      (ctx, request) => runtime().billing.checkout(ctx, request.body),
    );
    route(
      "POST",
      "/billing/portal",
      "Open the current organization's billing portal",
      {
        ...read,
        body: empty,
        output: schema.billingRedirectSchema,
      },
      (ctx) => runtime().billing.portal(ctx),
    );
  }
  route(
    "POST",
    "/ingest",
    "Upload session records",
    {
      ...read,
      body: schema.ingestEnvelopeSchema,
      output: schema.ingestOutputSchema,
      status: 202,
      rate: "ingest",
    },
    (ctx, input) => runtime().ingest.execute(ctx, input.body),
  );
  route(
    "POST",
    "/search",
    "Search previous session messages",
    {
      ...read,
      body: schema.searchInputSchema,
      output: schema.searchOutputSchema,
    },
    (ctx, input) => runtime().search.execute(ctx, input.body),
  );
  route(
    "POST",
    "/query",
    "Query the caller-visible SQL schema",
    {
      ...read,
      body: schema.sqlInputSchema,
      output: schema.sqlOutputSchema,
      rate: "sql",
    },
    (ctx, input) => runtime().query.execute(ctx, input.body),
  );
  route(
    "GET",
    "/schema",
    "Describe the caller-visible SQL schema",
    { ...read, output: schema.schemaOutputSchema },
    (ctx) => runtime().sessions.schema(ctx),
  );
  route(
    "GET",
    "/sessions",
    "List sessions",
    {
      ...read,
      query: schema.sessionsInputSchema,
      output: schema.sessionsOutputSchema,
      csv: true,
    },
    (ctx, input) => runtime().sessions.list(ctx, input.query),
  );
  if (features.embeddings)
    route(
      "GET",
      "/sessions/:id/similar",
      "Find similar visible sessions",
      {
        body: noBody,
        query: schema.similarInputSchema,
        params: schema.uuidParamsSchema,
        output: schema.similarOutputSchema,
      },
      (context, { params, query }) => {
        const service = runtime().similar;
        if (!service)
          throw new Error("The optional similarity service is unavailable.");
        return service.execute(context, params.id, query);
      },
    );
  route(
    "GET",
    "/sessions/:id",
    "Read a session",
    {
      ...read,
      params: schema.uuidParamsSchema,
      query: schema.getQuerySchema,
      output: schema.getOutputSchema,
    },
    (ctx, input) =>
      runtime().sessions.get(ctx, {
        ...input.query,
        session_id: input.params.id,
      }),
  );
  route(
    "GET",
    "/sessions/:id/raw",
    "Read redacted source records",
    {
      ...read,
      params: schema.uuidParamsSchema,
      query: schema.paginationSchema,
      output: schema.rawOutputSchema,
    },
    (ctx, input) => runtime().sessions.raw(ctx, input.params.id, input.query),
  );
  route(
    "GET",
    "/sessions/:id/tree",
    "Read the visible session tree",
    {
      ...read,
      params: schema.uuidParamsSchema,
      query: schema.paginationSchema,
      output: schema.treeOutputSchema,
    },
    (ctx, input) => runtime().sessions.tree(ctx, input.params.id, input.query),
  );
  app.get(
    "/api/v1/sessions/:id/events",
    {
      config: { protected: true, rate: "read" },
      schema: {
        summary: "Watch session status changes",
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        params: schema.uuidParamsSchema,
        querystring: empty,
        response: {
          200: { content: { "text/event-stream": { schema: z.string() } } },
          "4xx": schema.errorSchema,
          "5xx": schema.errorSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = schema.uuidParamsSchema.parse(request.params);
      const stream = await runtime().events.open(requestContext(request), id);
      const controller = new AbortController();
      streams.add(controller);
      reply.raw.on("close", () => {
        controller.abort();
      });
      reply
        .header("Content-Type", "text/event-stream")
        .header("Connection", "close")
        .header("Cache-Control", "no-cache")
        .header("X-Accel-Buffering", "no");
      hijackRaw(reply);
      // A comment line every 30 s keeps proxies with idle timeouts (Cloudflare closes
      // idle responses after 100 s) from cutting a quiet live session's stream.
      const heartbeat = setInterval(() => {
        if (!controller.signal.aborted && !reply.raw.destroyed)
          reply.raw.write(": keepalive\n\n");
      }, 30_000);
      try {
        let sequence = 0;
        for await (const event of stream.result.changes(controller.signal)) {
          if (controller.signal.aborted) break;
          const drained = reply.raw.write(
            `id: ${String(++sequence)}\nevent: session\ndata: ${JSON.stringify(event)}\n\n`,
          );
          if (!drained)
            await once(reply.raw, "drain", { signal: controller.signal });
        }
      } catch {
        /* Reauthentication or visibility loss closes the connection. */
      } finally {
        clearInterval(heartbeat);
        streams.delete(controller);
        reply.raw.end();
      }
    },
  );
  route(
    "GET",
    "/repos",
    "List repositories",
    {
      ...read,
      query: schema.reposInputSchema,
      output: schema.reposOutputSchema,
      csv: true,
    },
    (ctx, input) => runtime().sessions.repos(ctx, input.query),
  );
  route(
    "GET",
    "/installations",
    "List installations",
    {
      ...read,
      query: schema.installationsInputSchema,
      output: schema.installationsOutputSchema,
      csv: true,
    },
    (ctx, input) => runtime().sessions.installations(ctx, input.query),
  );
  route(
    "GET",
    "/sessions/:id/reuse",
    "List sessions that reused or were reused by this session",
    {
      ...read,
      params: schema.uuidParamsSchema,
      query: schema.sessionReuseInputSchema,
      output: schema.sessionReuseOutputSchema,
    },
    (ctx, input) => runtime().sessions.reuse(ctx, input.params.id, input.query),
  );
  route(
    "GET",
    "/admin/domains",
    "List Google SSO domain access",
    {
      ...read,
      query: schema.domainsInputSchema,
      output: schema.domainsOutputSchema,
    },
    (ctx, input) => runtime().auth.domains(ctx, input.query),
  );
  if (features.domainEnrollment)
    route(
      "POST",
      "/admin/domains",
      "Allow a Google email domain to join this organization",
      {
        ...read,
        body: schema.domainInputSchema,
        output: schema.domainOutputSchema,
      },
      (ctx, input) => runtime().auth.domain(ctx, input.body),
    );
  if (features.saas) {
    route(
      "POST",
      "/me/organizations",
      "Create another organization with a verified SaaS identity",
      {
        ...read,
        body: schema.onboardingInputSchema,
        output: schema.onboardingOutputSchema,
      },
      (ctx, input) => runtime().auth.createOrganization(ctx, input.body),
    );
    route(
      "POST",
      "/onboarding",
      "Create the verified identity's first organization",
      {
        ...read,
        body: schema.onboardingInputSchema,
        output: schema.onboardingOutputSchema,
      },
      (ctx, input) => runtime().auth.onboard(ctx, input.body),
    );
  }
  route(
    "GET",
    "/me",
    "Read the current identity and organization",
    { ...read, output: schema.meOutputSchema },
    (ctx) => runtime().auth.me(ctx),
  );
  route(
    "GET",
    "/me/organizations",
    "List current organization memberships",
    { ...read, output: schema.organizationsOutputSchema },
    (ctx) => runtime().auth.organizations(ctx),
  );
  route(
    "POST",
    "/me/organization",
    "Select an active organization",
    {
      ...read,
      body: schema.organizationSwitchInputSchema,
      output: schema.organizationSwitchOutputSchema,
    },
    (ctx, input) =>
      runtime().auth.switchOrganization(ctx, input.body.organization_id),
  );
  route(
    "GET",
    "/me/keys",
    "List your organization API keys",
    {
      ...read,
      query: schema.keysInputSchema,
      output: schema.keysOutputSchema,
      csv: true,
    },
    (ctx, input) => runtime().auth.listKeys(ctx, input.query),
  );
  route(
    "POST",
    "/me/keys",
    "Create your organization API key",
    {
      ...read,
      body: schema.keyCreateInputSchema,
      output: schema.keyCreateOutputSchema,
    },
    (ctx, input) => runtime().auth.createKey(ctx, input.body),
  );
  route(
    "DELETE",
    "/me/keys/:id",
    "Revoke your organization API key",
    {
      ...read,
      params: schema.identityParamsSchema,
      body: schema.reasonInputSchema,
      output: schema.mutationOutputSchema,
    },
    (ctx, input) => runtime().auth.revokeKey(ctx, input.params.id, input.body),
  );
  route(
    "POST",
    "/me/keys/:id/reveal",
    "Reveal one of your API keys",
    {
      ...read,
      params: schema.identityParamsSchema,
      output: schema.apiKeyRevealOutputSchema,
    },
    (ctx, input) => runtime().auth.revealKey(ctx, input.params.id),
  );
  route(
    "GET",
    "/admin/users",
    "List organization members",
    {
      ...read,
      query: schema.membersInputSchema,
      output: schema.membersOutputSchema,
      csv: true,
    },
    (ctx, input) => runtime().members.list(ctx, input.query),
  );
  route(
    "POST",
    "/admin/users",
    "Add people to the organization",
    {
      ...read,
      body: schema.memberAddInputSchema,
      output: schema.memberAddOutputSchema,
    },
    (ctx, input) => runtime().members.add(ctx, input.body),
  );
  route(
    "POST",
    "/admin/users/password-setup",
    "Issue initial password setup",
    {
      ...read,
      body: schema.passwordSetupInputSchema,
      output: schema.passwordSetupOutputSchema,
    },
    (ctx, input) => runtime().members.passwordSetup(ctx, input.body.user_id),
  );
  route(
    "PATCH",
    "/admin/users/:id/role",
    "Change an organization member role",
    {
      ...read,
      params: schema.identityParamsSchema,
      body: schema.memberRoleInputSchema,
      output: schema.mutationOutputSchema,
    },
    (ctx, input) => runtime().members.role(ctx, input.params.id, input.body),
  );
  route(
    "PATCH",
    "/admin/users/:id/suspension",
    "Suspend or restore a membership",
    {
      ...read,
      params: schema.identityParamsSchema,
      body: schema.memberSuspensionInputSchema,
      output: schema.mutationOutputSchema,
    },
    (ctx, input) => runtime().members.suspend(ctx, input.params.id, input.body),
  );
  route(
    "DELETE",
    "/admin/users/:id",
    "Remove an organization member",
    {
      ...read,
      params: schema.identityParamsSchema,
      body: schema.reasonInputSchema,
      output: schema.mutationOutputSchema,
    },
    (ctx, input) => runtime().members.remove(ctx, input.params.id, input.body),
  );
  route(
    "GET",
    "/admin/keys",
    "List organization API keys",
    {
      ...read,
      query: schema.keysInputSchema,
      output: schema.keysOutputSchema,
      csv: true,
    },
    (ctx, input) => runtime().auth.listKeys(ctx, input.query, false),
  );
  route(
    "DELETE",
    "/admin/keys/:id",
    "Revoke an organization API key",
    {
      ...read,
      params: schema.identityParamsSchema,
      body: schema.reasonInputSchema,
      output: schema.mutationOutputSchema,
    },
    (ctx, input) =>
      runtime().auth.revokeKey(ctx, input.params.id, input.body, false),
  );
  route(
    "POST",
    "/admin/sessions/:id/visibility",
    "Change session visibility",
    {
      ...read,
      params: schema.uuidParamsSchema,
      body: schema.visibilityInputSchema.omit({ session_id: true }),
      output: schema.mutationOutputSchema,
    },
    (ctx, input) =>
      runtime().admin.setVisibility(ctx, {
        ...input.body,
        session_id: input.params.id,
      }),
  );
  route(
    "POST",
    "/admin/installations/:id/tools",
    "Enable or disable installation MCP tools",
    {
      ...read,
      params: schema.uuidParamsSchema,
      body: schema.enabledInputSchema,
      output: schema.installationToolsOutputSchema,
    },
    (ctx, input) =>
      runtime().admin.setInstallationTools(ctx, input.params.id, input.body),
  );
  route(
    "POST",
    "/admin/sessions/:id/purge",
    "Purge session contents",
    {
      ...read,
      params: schema.uuidParamsSchema,
      body: schema.purgeInputSchema.omit({ session_id: true }),
      output: schema.purgeOutputSchema,
    },
    (ctx, input) =>
      runtime().admin.purge(ctx, {
        ...input.body,
        session_id: input.params.id,
      }),
  );
  route(
    "GET",
    "/admin/audit",
    "List organization audit events",
    {
      ...read,
      query: schema.auditListInputSchema,
      output: schema.auditOutputSchema,
      csv: true,
    },
    (ctx, input) => runtime().admin.auditLog(ctx, input.query),
  );
  route(
    "GET",
    "/admin/metrics/:group",
    "Read filtered organization metrics",
    {
      ...read,
      params: z.strictObject({ group: schema.metricsGroupSchema }),
      query: schema.metricsInputSchema,
      output: schema.metricsOutputSchema,
      csv: true,
    },
    (ctx, input) =>
      runtime().admin.metrics(ctx, input.params.group, input.query),
  );
  route(
    "GET",
    "/admin/status",
    "Read organization ingestion status",
    { ...read, output: schema.statusOutputSchema },
    (ctx) => runtime().admin.status(ctx),
  );
  route(
    "GET",
    "/admin/redaction/policies",
    "List redaction policies",
    {
      ...read,
      query: schema.redactionPoliciesInputSchema,
      output: schema.redactionPoliciesOutputSchema,
      csv: true,
    },
    (ctx, input) => runtime().policies.list(ctx, input.query),
  );
  route(
    "POST",
    "/admin/redaction/policies",
    "Create a redaction policy",
    {
      ...read,
      body: schema.redactionPolicyInputSchema,
      output: schema.redactionPolicySchema,
    },
    (ctx, input) => runtime().policies.save(ctx, null, input.body),
  );
  route(
    "PATCH",
    "/admin/redaction/policies/:id",
    "Update a redaction policy",
    {
      ...read,
      params: schema.uuidParamsSchema,
      body: schema.redactionPolicyInputSchema,
      output: schema.redactionPolicySchema,
    },
    (ctx, input) => runtime().policies.save(ctx, input.params.id, input.body),
  );
  route(
    "DELETE",
    "/admin/redaction/policies/:id",
    "Remove a redaction policy",
    {
      ...read,
      params: schema.uuidParamsSchema,
      body: schema.reasonInputSchema,
      output: schema.mutationOutputSchema,
    },
    (ctx, input) => runtime().policies.remove(ctx, input.params.id, input.body),
  );
  route(
    "POST",
    "/admin/redaction/test",
    "Test organization redaction policies",
    {
      ...read,
      body: schema.redactionTestInputSchema,
      output: schema.redactionTestOutputSchema,
    },
    (ctx, input) => runtime().policies.test(ctx, input.body),
  );
  route(
    "GET",
    "/admin/redaction/rescan/:id",
    "Read redaction rescan progress",
    {
      ...read,
      params: schema.identityParamsSchema,
      output: schema.jobProgressSchema,
    },
    (ctx, input) => runtime().jobs.progress(ctx, input.params.id),
  );
  route(
    "POST",
    "/admin/redaction/rescan",
    "Rescan existing organization records",
    {
      ...read,
      body: schema.redactionRescanInputSchema,
      output: schema.jobOutputSchema,
    },
    (ctx, input) => runtime().admin.rescan(ctx, input.body),
  );
}
