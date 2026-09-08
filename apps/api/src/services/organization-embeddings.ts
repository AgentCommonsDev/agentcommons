import {
  hasAdminAuthority,
  lockTracePublication,
  type Prisma,
  type PrismaClient,
} from "@agentcommons/db";
import {
  organizationEmbeddingsInputSchema,
  organizationEmbeddingsOutputSchema,
  type CallerContext,
} from "@agentcommons/core";
import type { EmbeddingProvider } from "../embeddings/provider.js";
import { organizationEmbeddingSetting } from "../embeddings/settings.js";
import type { AuditService } from "./audit.js";
import { lockOrganization } from "./auth.js";
import { mutationOperation } from "./mutation.js";
import { readOperation } from "./read-operation.js";
import { ServiceError, type ServiceContext } from "./context.js";

export class OrganizationEmbeddingsService {
  constructor(
    private readonly dependencies: {
      prisma: PrismaClient;
      audit: AuditService;
      saas?: boolean;
      provider?: Pick<EmbeddingProvider, "name" | "model">;
      jobs: {
        catchupOrganization(
          tx: Prisma.TransactionClient,
          organizationId: string,
        ): Promise<void>;
      };
    },
  ) {}
  private async state(tx: Prisma.TransactionClient, caller: CallerContext) {
    const setting = await organizationEmbeddingSetting(
      tx,
      caller.organizationId,
      false,
      this.dependencies.saas,
    );
    const counts = await tx.$queryRaw<
      { total: number; indexed: number }[]
    >`SELECT count(*)::integer AS total,count(*) FILTER(WHERE published_revision>0 AND embedding_source_revision=published_revision AND embedding_revision IS NOT NULL)::integer AS indexed FROM trace_session_control WHERE organization_id=${caller.organizationId} AND purged_at IS NULL AND (${hasAdminAuthority(caller)} OR visibility='PUBLIC')`;
    const total = counts[0]?.total ?? 0;
    const indexed = counts[0]?.indexed ?? 0;
    const last = await tx.embeddingAttempt.findFirst({
      where: { organizationId: caller.organizationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { state: true },
    });
    return organizationEmbeddingsOutputSchema.parse({
      enabled: setting.requested,
      entitled: setting.entitled,
      available: Boolean(this.dependencies.provider),
      effective: Boolean(this.dependencies.provider) && setting.enabled,
      provider: this.dependencies.provider?.name ?? null,
      model: this.dependencies.provider?.model ?? null,
      sessions_total: total,
      sessions_indexed: indexed,
      sessions_pending: total - indexed,
      last_attempt: last?.state ?? null,
    });
  }
  get(context: ServiceContext) {
    return readOperation(
      this.dependencies.audit,
      context,
      { action: "organization.embeddings.read", resourceType: "organization" },
      (caller) =>
        this.dependencies.prisma.$transaction(async (tx) => {
          await organizationEmbeddingSetting(
            tx,
            caller.organizationId,
            true,
            this.dependencies.saas,
          );
          return this.state(tx, caller);
        }),
      undefined,
      context.caller && hasAdminAuthority(context.caller) ? "admin" : "read",
    );
  }
  set(context: ServiceContext, input: unknown) {
    return mutationOperation(
      this.dependencies,
      context,
      "admin",
      {
        action: "organization.embeddings.update",
        resourceType: "organization",
        detail: input,
      },
      async (tx, caller) => {
        const request = organizationEmbeddingsInputSchema.parse(input);
        await lockOrganization(tx, caller);
        if (request.enabled && !this.dependencies.provider)
          throw new ServiceError(
            409,
            "EMBEDDINGS_UNAVAILABLE",
            "The operator must configure and enable an embedding provider first.",
          );
        const previous = await organizationEmbeddingSetting(
          tx,
          caller.organizationId,
          false,
          this.dependencies.saas,
        );
        if (previous.requested !== request.enabled) {
          await lockTracePublication(tx, caller.organizationId, "write");
          await tx.organizationSettings.upsert({
            where: { organizationId: caller.organizationId },
            create: {
              organizationId: caller.organizationId,
              embeddingsEnabled: request.enabled,
              revision: 1,
            },
            update: {
              embeddingsEnabled: request.enabled,
              revision: { increment: 1 },
            },
          });
          if (request.enabled)
            await this.dependencies.jobs.catchupOrganization(
              tx,
              caller.organizationId,
            );
        }
        return {
          result: await this.state(tx, caller),
          resourceIds: [caller.organizationId],
          detail: {
            enabled: request.enabled,
            previous_enabled: previous.requested,
            reason: request.reason,
          },
        };
      },
    );
  }
}
