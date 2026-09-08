import { TraceAuditProjectionService } from "./services/trace-audit-projection.js";
import { TraceReaders, TraceRepository } from "@agentcommons/traces";
import { TraceProjectionService } from "./services/trace-projection.js";
import { BillingMeterService } from "./services/billing-meter.js";
import { OrganizationEmbeddingsService } from "./services/organization-embeddings.js";
import { createPolicyCache } from "./services/policy-cache.js";
import { EmbeddingService } from "./embeddings/service.js";
import {
  FakeEmbeddingProvider,
  OpenAIEmbeddingProvider,
} from "./embeddings/provider.js";
import { SimilarService } from "./services/similar.js";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@agentcommons/db";
import { z } from "zod";
import { policyDefinitionSchema } from "@agentcommons/core";
import { createApp } from "./app.js";
import { environment, type Env } from "./env.js";
import { AuthService } from "./services/auth.js";
import { AuditService } from "./services/audit.js";
import { MembershipService } from "./services/membership.js";
import { CursorCodec } from "./services/cursor.js";
import { PolicyService, seedPolicies } from "./services/policies.js";
import { SearchService } from "./services/search.js";
import { QueryService } from "./services/query.js";
import { SessionService } from "./services/session.js";
import { SessionEventsService } from "./services/session-events.js";
import { IngestService } from "./services/ingest.js";
import { AdminService } from "./services/admin.js";
import { JobService } from "./services/jobs.js";
import { HealthService } from "./services/health.js";
import { HomeService } from "./services/home.js";
import { BillingService } from "./services/billing.js";
import { operatorContext } from "./auth/bootstrap.js";
import type { Services } from "./routes/services.js";

/** Compose the same services used by REST, MCP, workers, and integration tests. */
export async function createRuntime(env: Env) {
  const extras = z
    .array(policyDefinitionSchema)
    .parse(JSON.parse(env.REDACTION_EXTRA_PATTERNS));
  const prisma = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
  const readers = new TraceReaders(env.clickhouse, prisma, {
    embeddings: env.EMBEDDINGS_ENABLED,
    saas: env.INSTANCE_MODE === "saas",
  });
  const traces = new TraceRepository(env.clickhouse);
  try {
    const policies = createPolicyCache(prisma);
    const audit = new AuditService(prisma, policies);
    const organizations = await prisma.organization.findMany({
      select: { id: true },
    });
    for (const organization of organizations)
      await prisma.$transaction(async (tx) => {
        const inserted = await seedPolicies(tx, organization.id, null, extras);
        if (inserted > 0)
          await audit.write(
            operatorContext(),
            {
              action: "redaction.policies.seed",
              resourceType: "organization",
              resourceIds: [organization.id],
              actor: {
                organizationId: organization.id,
                userId: null,
                apiKeyId: null,
                authMethod: "operator",
              },
              detail: { inserted_count: inserted },
            },
            tx,
          );
      });
    const cursors = new CursorCodec(env.BETTER_AUTH_SECRET);
    const embeddings = env.EMBEDDINGS_ENABLED
      ? new EmbeddingService({
          prisma,
          audit,
          policies,
          traces,
          billing: env.billing,
          dailyTokenBudget: env.EMBEDDINGS_DAILY_TOKEN_BUDGET,
          provider:
            env.EMBEDDINGS_PROVIDER === "fake"
              ? new FakeEmbeddingProvider()
              : new OpenAIEmbeddingProvider({
                  apiKey: z.string().min(1).parse(env.OPENAI_API_KEY),
                }),
        })
      : undefined;
    const dependencies = {
      prisma,
      readers,
      audit,
      cursors,
      saas: env.INSTANCE_MODE === "saas",
    };
    const billingMeter =
      env.INSTANCE_MODE === "saas" && env.auth.stripe
        ? new BillingMeterService({
            prisma,
            audit,
            stripe: env.auth.stripe.client,
          })
        : undefined;
    const projection: TraceProjectionService = new TraceProjectionService({
      prisma,
      audit,
      repository: traces,
      scheduleEmbeddings: (tx, data) => jobs.schedule(tx, data),
      allowedEmailDomains: env.auth.allowedEmailDomains,
      saas: env.INSTANCE_MODE === "saas",
    });
    const jobs: JobService = new JobService({
      traces: projection,
      traceAudit: new TraceAuditProjectionService({ prisma, audit, traces }),
      ...(billingMeter ? { billingMeter } : {}),
      authConfiguration: env.auth,
      prisma,
      audit,
      ...(embeddings ? { embeddings } : {}),
      connectionString: env.DATABASE_URL,
      allowedEmailDomains: env.auth.allowedEmailDomains,
      auditRetentionDays: env.AUDIT_RETENTION_DAYS,
      onError: (error) => {
        process.stderr.write(`${error.message}\n`);
      },
    });
    const organizationEmbeddings = new OrganizationEmbeddingsService({
      saas: env.INSTANCE_MODE === "saas",
      prisma,
      audit,
      jobs,
      ...(embeddings
        ? {
            provider: {
              name: env.EMBEDDINGS_PROVIDER,
              model: env.EMBEDDINGS_MODEL,
            },
          }
        : {}),
    });
    const auth = new AuthService(
      prisma,
      env.auth,
      audit,
      embeddings ? ["similar_sessions"] : [],
      jobs,
    );
    const services: Services = {
      dashboards: new DashboardService({
        prisma,
        audit,
        embeddings: env.EMBEDDINGS_ENABLED,
        saas: env.INSTANCE_MODE === "saas",
      }),
      organizationEmbeddings,
      billing: new BillingService({
        prisma,
        audit,
        configuration: env.billing,
        auth: env.auth,
      }),
      home: new HomeService(dependencies),
      auth,
      audit,
      ...(embeddings ? { similar: new SimilarService(dependencies) } : {}),
      jobs,
      health: new HealthService(prisma, traces),
      members: new MembershipService(prisma, env.auth, audit),
      search: new SearchService(
        dependencies,
        {
          context: env.SEARCH_CONTEXT_DEFAULT,
          limit: env.SEARCH_LIMIT_DEFAULT,
        },
        embeddings,
      ),
      query: new QueryService(dependencies, env.EMBEDDINGS_ENABLED),
      sessions: new SessionService(dependencies),
      events: new SessionEventsService({ readers, auth, audit }),
      ingest: new IngestService({
        prisma,
        audit,
        billing: env.billing,
        traces: jobs,
      }),
      policies: new PolicyService({ prisma, audit, cursors, cache: policies }),
      admin: new AdminService({
        prisma,
        readers,
        audit,
        cursors,
        jobs,
      }),
    };
    return {
      services,
      jobs,
      async close() {
        await jobs.stop();
        await readers.close();
        await traces.close();
        await prisma.$disconnect();
      },
    };
  } catch (error) {
    await readers.close();
    await traces.close();
    await prisma.$disconnect();
    throw error;
  }
}

export async function main() {
  const env = environment();
  const runtime = await createRuntime(env);
  const app = await createApp({ env, services: runtime.services });
  app.addHook("onClose", async () => runtime.close());
  try {
    await runtime.jobs.start();
    await app.listen({ port: env.PORT, host: env.HOST });
  } catch (error) {
    await app.close();
    throw error;
  }
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      void app.close().catch(() => {
        process.exitCode = 1;
      });
    });
  return app;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await main();
  } catch {
    process.stderr.write(
      "The server could not start. Check its configuration and database migrations.\n",
    );
    process.exitCode = 1;
  }
}
import { DashboardService } from "./services/dashboards.js";
