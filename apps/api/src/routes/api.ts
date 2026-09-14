import { once } from "node:events";
import { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as schema from "@agentcommons/core/schemas";
import { formatCsv, formatCsvLines } from "@agentcommons/core/format/csv";
import type { ServiceContext, ServiceResult } from "../services/context.js";
import { activeAdminRoutes, type RouteFeatures } from "./admin-routes.js";
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
/** A whole-record CSV export as a service streams it: the header's columns, then the rows. */
interface CsvExport {
  columns: readonly string[];
  rows: AsyncIterable<Record<string, unknown>>;
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
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    summary: string,
    contract: {
      body: B;
      query: Q;
      params: P;
      output: z.ZodType;
      status?: number;
      /**
       * How `format=csv` answers. `true`: the `{ items, cursor }` page the JSON route
       * returns, as one CSV page with `X-Next-Cursor`. An export: every row the service
       * streams, as one attachment, for a read whose JSON form is paged but whose file
       * is the whole record.
       */
      csv?:
        | true
        | {
            export: (
              context: ServiceContext,
              data: {
                body: z.output<B>;
                query: z.output<Q>;
                params: z.output<P>;
              },
            ) => Promise<CsvExport>;
            filename: (params: z.output<P>) => string;
          };
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
        const data = {
          body: contract.body.parse(request.body),
          query,
          params: contract.params.parse(request.params),
        };
        const context = requestContext(request);
        const csv = csvFormatSchema.safeParse(query).success
          ? contract.csv
          : undefined;
        if (csv !== undefined && csv !== true) {
          // The service reads the first page before this resolves, so a refused read
          // answers with its JSON error rather than an empty file.
          const { columns, rows } = await csv.export(context, data);
          return reply
            .code(200)
            .type("text/csv; charset=utf-8")
            .header(
              "Content-Disposition",
              `attachment; filename="${csv.filename(data.params)}"`,
            )
            .send(Readable.from(formatCsvLines(columns, rows)));
        }
        const value = await execute(context, data);
        reply.code(contract.status ?? 200);
        if (csv === true) {
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
  const sessionRead = (input: {
    query: z.output<typeof schema.getQuerySchema>;
    params: z.output<typeof schema.uuidParamsSchema>;
  }) => ({ ...input.query, session_id: input.params.id });
  route(
    "GET",
    "/sessions/:id",
    "Read a session",
    {
      ...read,
      params: schema.uuidParamsSchema,
      query: schema.getQuerySchema,
      output: schema.getOutputSchema,
      csv: {
        export: (ctx, input) =>
          runtime().sessions.export(ctx, sessionRead(input)),
        filename: ({ id }) => `session-${id}.csv`,
      },
    },
    (ctx, input) => runtime().sessions.get(ctx, sessionRead(input)),
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
    "/tool-policy",
    "Read the caller organization's active tool and command policy for offline enforcement",
    { ...read, output: schema.toolPolicyDocumentSchema },
    (ctx) => runtime().toolPolicy.active(ctx),
  );
  route(
    "POST",
    "/tool-policy/violations",
    "Report tool-policy decisions the pre-tool gate made",
    {
      ...read,
      body: schema.toolPolicyViolationsReportInputSchema,
      output: schema.toolPolicyViolationsReportOutputSchema,
      status: 202,
      rate: "ingest",
    },
    (ctx, input) => runtime().toolPolicy.report(ctx, input.body),
  );
  // The admin routes are data (`admin-routes.ts`): REST registers each active one here and
  // the MCP catalog derives the `administration` tools from the same table (ADR 0072).
  for (const admin of activeAdminRoutes(features))
    route(
      admin.method,
      admin.path,
      admin.summary,
      {
        body: admin.body ?? noBody,
        query: admin.query ?? empty,
        params: admin.params ?? empty,
        output: admin.output,
        ...(admin.csv ? { csv: true } : {}),
      },
      (ctx, data) => admin.execute(runtime(), ctx, data),
    );
}
