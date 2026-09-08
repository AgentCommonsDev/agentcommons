import { z } from "zod";
import { v7 as uuidv7 } from "uuid";
import type { DashboardProfile, PrismaClient } from "@agentcommons/db";
import {
  dashboardDefinitionSchema,
  dashboardDeleteOutputSchema,
  dashboardIdInputSchema,
  dashboardListOutputSchema,
  dashboardProfileSchema,
  dashboardSaveInputSchema,
  jsonValueSchema,
} from "@agentcommons/core";
import { organizationEmbeddingSetting } from "../embeddings/settings.js";
import { guardSql } from "../repositories/sql-guard.js";
import { createPolicyCache } from "./policy-cache.js";
import type { AuditService } from "./audit.js";
import { ServiceError, type ServiceContext } from "./context.js";
import { mutationOperation } from "./mutation.js";
import { readOperation } from "./read-operation.js";

function output(row: DashboardProfile) {
  return dashboardProfileSchema.parse({
    id: row.id,
    organization_id: row.organizationId,
    user_id: row.userId,
    name: row.name,
    definition: row.definition,
    revision: row.revision,
    updated_at: row.updatedAt.toISOString(),
  });
}

export class DashboardService {
  constructor(
    private readonly dependencies: {
      prisma: PrismaClient;
      audit: AuditService;
      embeddings: boolean;
      saas?: boolean;
    },
  ) {}

  list(context: ServiceContext) {
    return readOperation(
      this.dependencies.audit,
      context,
      { action: "dashboard.list", resourceType: "dashboard_profile" },
      async (caller) => {
        const rows = await this.dependencies.prisma.dashboardProfile.findMany({
          where: {
            organizationId: caller.organizationId,
            userId: caller.userId,
          },
          orderBy: [{ name: "asc" }, { id: "asc" }],
          take: 20,
        });
        return dashboardListOutputSchema.parse({
          items: rows.map(output),
          definition_schema: z.toJSONSchema(dashboardDefinitionSchema),
        });
      },
    );
  }

  save(context: ServiceContext, input: unknown) {
    return mutationOperation(
      this.dependencies,
      context,
      "read",
      { action: "dashboard.save", resourceType: "dashboard_profile" },
      async (tx, caller) => {
        const request = dashboardSaveInputSchema.parse(input);
        await tx.$queryRaw`SELECT id FROM public."user" WHERE id=${caller.userId} FOR UPDATE`;
        const owner = {
          organizationId: caller.organizationId,
          userId: caller.userId,
        };
        const existing = request.id
          ? await tx.dashboardProfile.findFirst({
              where: { ...owner, id: request.id },
            })
          : null;
        if (request.id && !existing)
          throw new ServiceError(
            404,
            "DASHBOARD_NOT_FOUND",
            "This dashboard is unavailable.",
          );
        if (existing && existing.revision !== request.revision)
          throw new ServiceError(
            409,
            "DASHBOARD_CHANGED",
            "This dashboard changed. Reload it before saving.",
          );
        if (
          !existing &&
          (await tx.dashboardProfile.count({ where: owner })) >= 20
        )
          throw new ServiceError(
            409,
            "DASHBOARD_LIMIT",
            "You can save up to 20 dashboards per organization. Delete one before adding another.",
          );
        const redactor = await createPolicyCache(tx).get(caller.organizationId);
        const cleaned = await redactor.json(
          jsonValueSchema.parse({
            name: request.name,
            definition: request.definition,
          }),
        );
        const content = dashboardSaveInputSchema.parse({
          ...request,
          ...z.record(z.string(), z.unknown()).parse(cleaned.value),
        });
        const embeddings =
          this.dependencies.embeddings &&
          (
            await organizationEmbeddingSetting(
              tx,
              caller.organizationId,
              false,
              Boolean(this.dependencies.saas),
            )
          ).enabled;
        for (const widget of content.definition.widgets)
          guardSql(widget.sql, embeddings);
        const data = {
          name: content.name,
          definition: content.definition,
          revision: (existing?.revision ?? -1) + 1,
        };
        const row = existing
          ? await tx.dashboardProfile.update({
              where: { id: existing.id },
              data,
            })
          : await tx.dashboardProfile.create({
              data: { id: uuidv7(), ...owner, ...data },
            });
        return {
          result: output(row),
          resourceIds: [row.id],
          detail: {
            revision: row.revision,
            widgets: content.definition.widgets.length,
          },
        };
      },
    );
  }

  delete(context: ServiceContext, input: unknown) {
    return mutationOperation(
      this.dependencies,
      context,
      "read",
      { action: "dashboard.delete", resourceType: "dashboard_profile" },
      async (tx, caller) => {
        const { id } = dashboardIdInputSchema.parse(input);
        const deleted = await tx.dashboardProfile.deleteMany({
          where: {
            id,
            organizationId: caller.organizationId,
            userId: caller.userId,
          },
        });
        return {
          result: dashboardDeleteOutputSchema.parse({
            deleted: deleted.count === 1,
          }),
          ...(deleted.count ? { resourceIds: [id] } : {}),
        };
      },
    );
  }
}
