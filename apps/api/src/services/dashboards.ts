import { z } from "zod";
import { v7 as uuidv7 } from "uuid";
import {
  hasAdminAuthority,
  type Dashboard as DashboardRow,
  type Prisma,
  type PrismaClient,
} from "@agentcommons/db";
import {
  dashboardDefaultOutputSchema,
  dashboardDefinitionSchema,
  dashboardDeleteOutputSchema,
  dashboardIdInputSchema,
  dashboardListOutputSchema,
  dashboardRenderInputSchema,
  dashboardRenderOutputSchema,
  dashboardSaveInputSchema,
  dashboardSavedLimit,
  dashboardSchema,
  jsonValueSchema,
  type CallerContext,
  type DashboardDefinition,
  type DashboardRenderOutput,
  type DashboardTileResult,
} from "@agentcommons/core";
import {
  builtinDashboard,
  builtinDashboards,
  dashboardParameterTypes,
  dashboardTileTemplates,
  teamOverviewDashboard,
  resolveDashboardVariables,
  type BuiltinDashboard,
} from "@agentcommons/core/dashboards";
import { createPolicyCache } from "./policy-cache.js";
import type { AuditService } from "./audit.js";
import { ServiceError, type ServiceContext } from "./context.js";
import { mutationOperation } from "./mutation.js";
import type { QueryService } from "./query.js";
import { readOperation } from "./read-operation.js";

const builtinTimestamp = "2026-01-01T00:00:00.000Z";
type Author = { user_id: string; email: string | null; name: string | null };
type Client = PrismaClient | Prisma.TransactionClient;

/** Rendered results live at most an hour, keyed by organization, caller scope, revision, tiles, variables and data version. */
const RENDER_CACHE_TTL_MS = 60 * 60_000;
const RENDER_CACHE_ENTRIES = 256;
const RENDER_CONCURRENCY = 4;
interface RenderEntry {
  output: DashboardRenderOutput;
  expiresAt: number;
}
/** Runs `task` over `items` with at most `limit` in flight, preserving order. */
async function concurrently<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const index = next++;
        const item = items[index];
        if (item === undefined) return;
        results[index] = await task(item);
      }
    }),
  );
  return results;
}
const dataVersionSchema = z.array(z.object({ version: z.string() })).length(1);
export class DashboardService {
  private readonly renderCache = new Map<string, RenderEntry>();
  /**
   * One indexed aggregate over the organization's session control rows. Any
   * publication, redaction pass, purge, visibility change or session end changes it,
   * so cached renders are served only while the underlying data is unchanged.
   */
  private async dataVersion(organizationId: string): Promise<string> {
    const rows = dataVersionSchema.parse(
      await this.dependencies.prisma.$queryRaw`SELECT md5(concat_ws('|',
        count(*),
        coalesce(sum(published_revision),0),
        coalesce(sum(redaction_generation),0),
        count(purged_at),
        count(*) FILTER (WHERE visibility='PRIVATE'),
        coalesce(sum(CASE WHEN visibility='PRIVATE' THEN hashtext(id::text) ELSE 0 END),0),
        count(*) FILTER (WHERE status<>'ACTIVE'),
        coalesce(max(last_activity_at),'epoch'::timestamptz)
      )) AS version FROM trace_session_control WHERE organization_id=${organizationId}`,
    );
    return z.string().parse(rows[0]?.version);
  }
  constructor(
    private readonly dependencies: {
      prisma: PrismaClient;
      audit: AuditService;
      query: QueryService;
    },
  ) {}

  private canEdit(caller: CallerContext, row: DashboardRow): boolean {
    return row.createdByUserId === caller.userId || hasAdminAuthority(caller);
  }
  private async authors(
    client: Client,
    ids: readonly string[],
  ): Promise<Map<string, Author>> {
    const users = await client.user.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, email: true, name: true },
    });
    return new Map(
      users.map((user) => [
        user.id,
        { user_id: user.id, email: user.email, name: user.name },
      ]),
    );
  }
  private summary(
    row: DashboardRow,
    caller: CallerContext,
    defaultId: string,
    authors: Map<string, Author>,
  ) {
    const definition = dashboardDefinitionSchema.safeParse(row.definition);
    return {
      id: row.id,
      organization_id: row.organizationId,
      name: row.name,
      description: row.description,
      revision: row.revision,
      builtin: false,
      is_default: row.id === defaultId,
      can_edit: this.canEdit(caller, row),
      created_by: authors.get(row.createdByUserId) ?? {
        user_id: row.createdByUserId,
        email: null,
        name: null,
      },
      tile_count: definition.success ? definition.data.tiles.length : 0,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    };
  }
  private builtin(
    dashboard: BuiltinDashboard,
    caller: CallerContext,
    defaultId: string,
  ) {
    return {
      id: dashboard.id,
      organization_id: caller.organizationId,
      name: dashboard.name,
      description: dashboard.description,
      revision: 0,
      builtin: true,
      is_default: defaultId === dashboard.id,
      can_edit: false,
      created_by: null,
      tile_count: dashboard.definition.tiles.length,
      created_at: builtinTimestamp,
      updated_at: builtinTimestamp,
    };
  }
  /** The saved default, or the shipped default built-in when an organization has none. */
  private async defaultId(
    client: Client,
    organizationId: string,
  ): Promise<string> {
    const row = await client.dashboard.findFirst({
      where: { organizationId, isDefault: true },
      select: { id: true },
    });
    return row?.id ?? teamOverviewDashboard.id;
  }
  /** The definition a render request addresses: inline, built-in or saved (with its revision). */
  private async source(
    caller: CallerContext,
    request: {
      id?: string | undefined;
      definition?: DashboardDefinition | undefined;
    },
  ): Promise<{ definition: DashboardDefinition; revision: number }> {
    if (request.definition !== undefined)
      return { definition: request.definition, revision: 0 };
    const id = z.string().parse(request.id);
    const builtin = builtinDashboard(id);
    if (builtin) return { definition: builtin.definition, revision: 0 };
    const row = await this.find(this.dependencies.prisma, caller, id);
    return { definition: this.definitionOf(row), revision: row.revision };
  }
  private async find(
    client: Client,
    caller: CallerContext,
    id: string,
  ): Promise<DashboardRow> {
    const row = await client.dashboard.findFirst({
      where: { organizationId: caller.organizationId, id },
    });
    if (!row)
      throw new ServiceError(
        404,
        "DASHBOARD_NOT_FOUND",
        "This dashboard is unavailable.",
      );
    return row;
  }
  private definitionOf(row: DashboardRow): DashboardDefinition {
    const parsed = dashboardDefinitionSchema.safeParse(row.definition);
    if (!parsed.success)
      throw new ServiceError(
        409,
        "DASHBOARD_INVALID",
        "This dashboard was saved in an older format. Delete it or ask an admin to recreate it.",
      );
    return parsed.data;
  }
  private async present(
    client: Client,
    caller: CallerContext,
    row: DashboardRow,
    definition: DashboardDefinition,
  ) {
    const [defaultId, authors] = await Promise.all([
      this.defaultId(client, caller.organizationId),
      this.authors(client, [row.createdByUserId]),
    ]);
    return dashboardSchema.parse({
      ...this.summary(row, caller, defaultId, authors),
      definition,
    });
  }

  list(context: ServiceContext) {
    return readOperation(
      this.dependencies.audit,
      context,
      { action: "dashboard.list", resourceType: "dashboard" },
      async (caller) => {
        const rows = await this.dependencies.prisma.dashboard.findMany({
          where: { organizationId: caller.organizationId },
          orderBy: [{ name: "asc" }, { id: "asc" }],
          take: dashboardSavedLimit,
        });
        const defaultId =
          rows.find((row) => row.isDefault)?.id ?? teamOverviewDashboard.id;
        const authors = await this.authors(
          this.dependencies.prisma,
          rows.map((row) => row.createdByUserId),
        );
        return dashboardListOutputSchema.parse({
          items: [
            ...builtinDashboards.map((dashboard) =>
              this.builtin(dashboard, caller, defaultId),
            ),
            ...rows.map((row) => this.summary(row, caller, defaultId, authors)),
          ],
          default_id: defaultId,
          // Self-contained for agents (no $ref/$defs, which some model APIs reject):
          // an empty metadata registry keeps the OpenAPI component ids out of it.
          definition_schema: z.toJSONSchema(dashboardDefinitionSchema, {
            io: "input",
            metadata: z.registry(),
          }),
          templates: dashboardTileTemplates,
        });
      },
      (result) => ({ dashboards: result.items.length }),
    );
  }

  get(context: ServiceContext, input: unknown) {
    return readOperation(
      this.dependencies.audit,
      context,
      { action: "dashboard.get", resourceType: "dashboard" },
      async (caller) => {
        const { id } = dashboardIdInputSchema.parse(input);
        const builtin = builtinDashboard(id);
        if (builtin)
          return dashboardSchema.parse({
            ...this.builtin(
              builtin,
              caller,
              await this.defaultId(
                this.dependencies.prisma,
                caller.organizationId,
              ),
            ),
            definition: builtin.definition,
          });
        const row = await this.find(this.dependencies.prisma, caller, id);
        return this.present(
          this.dependencies.prisma,
          caller,
          row,
          this.definitionOf(row),
        );
      },
      undefined,
      "read",
      (result) => [result.id],
    );
  }

  save(context: ServiceContext, input: unknown) {
    return mutationOperation(
      this.dependencies,
      context,
      "read",
      { action: "dashboard.save", resourceType: "dashboard" },
      async (tx, caller) => {
        const request = dashboardSaveInputSchema.parse(input);
        if (request.id !== undefined && builtinDashboard(request.id))
          throw new ServiceError(
            409,
            "DASHBOARD_BUILTIN",
            "Built-in dashboards are read-only. Duplicate one to make changes.",
          );
        await tx.$queryRaw`SELECT id FROM public.organization WHERE id=${caller.organizationId} FOR UPDATE`;
        const existing = request.id
          ? await this.find(tx, caller, request.id)
          : null;
        if (existing && !this.canEdit(caller, existing))
          throw new ServiceError(
            403,
            "DASHBOARD_FORBIDDEN",
            "Only the person who created this dashboard or an organization admin can change it.",
          );
        if (existing && existing.revision !== request.revision)
          throw new ServiceError(
            409,
            "DASHBOARD_CHANGED",
            "This dashboard changed since you opened it. Reload it before saving.",
          );
        if (
          !existing &&
          (await tx.dashboard.count({
            where: { organizationId: caller.organizationId },
          })) >= dashboardSavedLimit
        )
          throw new ServiceError(
            409,
            "DASHBOARD_LIMIT",
            `This organization can keep up to ${String(dashboardSavedLimit)} dashboards. Delete one before adding another.`,
          );
        const redactor = await createPolicyCache(tx).get(caller.organizationId);
        const cleaned = await redactor.json(
          jsonValueSchema.parse({
            name: request.name,
            description: request.description,
            definition: request.definition,
          }),
        );
        const content = dashboardSaveInputSchema.parse({
          ...request,
          ...z.record(z.string(), z.unknown()).parse(cleaned.value),
        });
        const types = dashboardParameterTypes(content.definition.variables);
        for (const tile of content.definition.tiles)
          if ("sql" in tile)
            try {
              await this.dependencies.query.guard(caller, tile.sql, types, tx);
            } catch (error) {
              if (error instanceof ServiceError)
                throw new ServiceError(
                  error.statusCode,
                  error.code,
                  `Tile "${tile.id}": ${error.message}`,
                  { tile: tile.id, cause: error.detail },
                );
              throw error;
            }
        const data = {
          name: content.name,
          description: content.description,
          definition: content.definition,
          revision: (existing?.revision ?? -1) + 1,
        };
        const row = existing
          ? await tx.dashboard.update({ where: { id: existing.id }, data })
          : await tx.dashboard.create({
              data: {
                id: uuidv7(),
                organizationId: caller.organizationId,
                createdByUserId: caller.userId,
                ...data,
              },
            });
        return {
          result: await this.present(tx, caller, row, content.definition),
          resourceIds: [row.id],
          detail: {
            revision: row.revision,
            tiles: content.definition.tiles.length,
            created: existing === null,
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
      { action: "dashboard.delete", resourceType: "dashboard" },
      async (tx, caller) => {
        const { id } = dashboardIdInputSchema.parse(input);
        if (builtinDashboard(id))
          throw new ServiceError(
            409,
            "DASHBOARD_BUILTIN",
            "Built-in dashboards cannot be deleted.",
          );
        const row = await this.find(tx, caller, id);
        if (!this.canEdit(caller, row))
          throw new ServiceError(
            403,
            "DASHBOARD_FORBIDDEN",
            "Only the person who created this dashboard or an organization admin can delete it.",
          );
        await tx.dashboard.delete({ where: { id: row.id } });
        return {
          result: dashboardDeleteOutputSchema.parse({ deleted: true }),
          resourceIds: [id],
          detail: { was_default: row.isDefault },
        };
      },
    );
  }

  setDefault(context: ServiceContext, input: unknown) {
    return mutationOperation(
      this.dependencies,
      context,
      "admin",
      { action: "dashboard.default", resourceType: "dashboard" },
      async (tx, caller) => {
        const { id } = dashboardIdInputSchema.parse(input);
        // "No saved default" always means the shipped default built-in, so another
        // built-in cannot be the default without a saved copy.
        const builtin = builtinDashboard(id);
        if (builtin && builtin.id !== teamOverviewDashboard.id)
          throw new ServiceError(
            409,
            "DASHBOARD_BUILTIN",
            `${builtin.name} cannot be the Home default. Duplicate it and make the copy the default, or choose ${teamOverviewDashboard.name}.`,
          );
        await tx.$queryRaw`SELECT id FROM public.organization WHERE id=${caller.organizationId} FOR UPDATE`;
        const row = builtin ? null : await this.find(tx, caller, id);
        await tx.dashboard.updateMany({
          where: { organizationId: caller.organizationId, isDefault: true },
          data: { isDefault: false },
        });
        if (row)
          await tx.dashboard.update({
            where: { id: row.id },
            data: { isDefault: true },
          });
        return {
          result: dashboardDefaultOutputSchema.parse({ default_id: id }),
          resourceIds: [id],
        };
      },
    );
  }

  render(context: ServiceContext, input: unknown) {
    const parsed = dashboardRenderInputSchema.safeParse(input);
    return readOperation(
      this.dependencies.audit,
      context,
      {
        action: "dashboard.render",
        resourceType: "dashboard",
        detail: parsed.success
          ? {
              id: parsed.data.id ?? null,
              inline: parsed.data.definition !== undefined,
              tiles: parsed.data.tiles ?? null,
              variables: parsed.data.variables,
            }
          : null,
      },
      async (caller) => {
        if (!parsed.success)
          throw new ServiceError(
            400,
            "DASHBOARD_INVALID_INPUT",
            parsed.error.issues.map((issue) => issue.message).join(" "),
          );
        const request = parsed.data;
        const { definition, revision } = await this.source(caller, request);
        const selected = request.tiles
          ? definition.tiles.filter((tile) => request.tiles?.includes(tile.id))
          : definition.tiles;
        const known = new Set(definition.tiles.map((tile) => tile.id));
        const unknown = request.tiles?.filter((id) => !known.has(id)) ?? [];
        if (unknown.length)
          throw new ServiceError(
            400,
            "DASHBOARD_TILE_UNKNOWN",
            `This dashboard has no tile named ${unknown.join(", ")}.`,
          );
        const { parameters, resolved } = resolveDashboardVariables(
          definition.variables,
          request.variables,
        );
        const parameterTypes = dashboardParameterTypes(definition.variables);
        // Saved dashboards cache per caller scope (admins share one entry; members get
        // their own because row policies show them their private sessions) and per data
        // version, so a hit is always current and a miss follows any change.
        const cacheKey =
          request.definition === undefined
            ? JSON.stringify([
                caller.organizationId,
                hasAdminAuthority(caller) ? "admin" : `user:${caller.userId}`,
                request.id,
                revision,
                request.tiles ?? null,
                resolved,
                await this.dataVersion(caller.organizationId),
              ])
            : null;
        if (cacheKey !== null && !request.refresh) {
          const hit = this.renderCache.get(cacheKey);
          if (hit && hit.expiresAt > Date.now())
            return { ...hit.output, cached: true };
          if (hit) this.renderCache.delete(cacheKey);
        }
        const tiles = await concurrently(
          selected.filter((tile) => "sql" in tile),
          RENDER_CONCURRENCY,
          async (tile): Promise<DashboardTileResult> => {
            try {
              return {
                id: tile.id,
                result: await this.dependencies.query.run(caller, {
                  sql: tile.sql,
                  parameters,
                  parameterTypes,
                }),
                error: null,
              };
            } catch (error) {
              if (!(error instanceof ServiceError)) throw error;
              return {
                id: tile.id,
                result: null,
                error: { code: error.code, message: error.message },
              };
            }
          },
        );
        const output = dashboardRenderOutputSchema.parse({
          tiles,
          variables: resolved,
          rendered_at: new Date().toISOString(),
          cached: false,
        });
        if (cacheKey !== null) {
          if (this.renderCache.size >= RENDER_CACHE_ENTRIES) {
            const oldest = this.renderCache.keys().next().value;
            if (oldest !== undefined) this.renderCache.delete(oldest);
          }
          this.renderCache.set(cacheKey, {
            output,
            expiresAt: Date.now() + RENDER_CACHE_TTL_MS,
          });
        }
        return output;
      },
      (result) => ({
        tiles: result.tiles.length,
        errors: result.tiles.filter((tile) => tile.error !== null).length,
        cached: result.cached,
      }),
      "read",
      () => (parsed.success && parsed.data.id ? [parsed.data.id] : []),
    );
  }
}
