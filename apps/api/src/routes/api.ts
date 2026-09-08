import { once } from "node:events";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as schema from "@agentcommons/core/schemas";
import { formatCsv } from "@agentcommons/core/format";
import type { ServiceContext, ServiceResult } from "../services/context.js";
import { requestContext } from "./context.js";
import type { Services } from "./services.js";

const empty = z.strictObject({});
const noBody = z.strictObject({}).optional();
export function registerApiRoutes(
  app: FastifyInstance,
  services?: Services,
  features: { embeddings: boolean } = {
    embeddings: Boolean(services?.similar),
  },
): void {
  const streams = new Set<AbortController>();
  app.addHook("preClose", (done) => {
    for (const stream of streams) stream.abort();
    done();
  });
  const runtime = (): Services => {
    if (!services)
      throw new Error("This instance only generates the API contract.");
    return services;
  };
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
    },
    execute: (
      context: ServiceContext,
      data: { body: z.output<B>; query: z.output<Q>; params: z.output<P> },
    ) => Promise<ServiceResult<unknown>>,
  ) {
    app.route({
      method,
      url: `/api/v1${path}`,
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
        if (
          contract.csv &&
          z.looseObject({ format: z.literal("csv") }).safeParse(query).success
        ) {
          const page = z
            .looseObject({
              items: z.array(z.unknown()),
              cursor: z.string().nullable(),
            })
            .parse(value.result);
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
    "/home",
    "Read the organization's reuse summary and your impact",
    {
      ...read,
      output: schema.homeSummarySchema,
    },
    (ctx) => runtime().home.summary(ctx),
  );
  route(
    "GET",
    "/home/:section",
    "Browse visible reuse activity and your corpus gaps",
    {
      ...read,
      params: z.strictObject({ section: schema.homeSectionSchema }),
      query: schema.homeInputSchema,
      output: schema.homeOutputSchema,
      csv: true,
    },
    (ctx, input) => runtime().home.list(ctx, input.params.section, input.query),
  );
  route(
    "POST",
    "/ingest",
    "Upload session records",
    {
      ...read,
      body: schema.ingestEnvelopeSchema,
      output: schema.ingestOutputSchema,
      status: 202,
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
    { ...read, body: schema.sqlInputSchema, output: schema.sqlOutputSchema },
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
        params: z.strictObject({ id: schema.sessionIdSchema }),
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
      params: schema.sessionParamsSchema,
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
      params: schema.sessionParamsSchema,
      query: schema.rawInputSchema,
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
      params: schema.sessionParamsSchema,
      query: schema.treeInputSchema,
      output: schema.treeOutputSchema,
    },
    (ctx, input) => runtime().sessions.tree(ctx, input.params.id, input.query),
  );
  app.get(
    "/api/v1/sessions/:id/events",
    {
      schema: {
        summary: "Watch session status changes",
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        params: schema.sessionParamsSchema,
        querystring: empty,
        response: {
          200: { content: { "text/event-stream": { schema: z.string() } } },
          "4xx": schema.errorSchema,
          "5xx": schema.errorSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = schema.sessionParamsSchema.parse(request.params);
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
      for (const [name, value] of Object.entries(reply.getHeaders()))
        if (value !== undefined) reply.raw.setHeader(name, value);
      reply.hijack();
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
      params: schema.sessionParamsSchema,
      query: schema.sessionReuseInputSchema,
      output: schema.sessionReuseOutputSchema,
    },
    (ctx, input) => runtime().sessions.reuse(ctx, input.params.id, input.query),
  );
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
      params: schema.sessionParamsSchema,
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
      params: schema.sessionParamsSchema,
      body: schema.installationToolsInputSchema,
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
      params: schema.sessionParamsSchema,
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
      params: schema.sessionParamsSchema,
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
      params: schema.sessionParamsSchema,
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
