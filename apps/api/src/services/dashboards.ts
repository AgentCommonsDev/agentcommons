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
  type CallerContext,
  type DashboardDefinition,
  type DashboardRenderOutput,
  type DashboardSummary,
  type DashboardTile,
  type DashboardTileResult,
  type DashboardVariableValue,
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
import type { TraceParameters } from "@agentcommons/traces";
import type { EmbeddingAvailability } from "../embeddings/settings.js";
import { createPolicyCache } from "./policy-cache.js";
import type { AuditService } from "./audit.js";
import { lockOrganization } from "./auth.js";
import { ServiceError, type ServiceContext } from "./context.js";
import { mutationOperation } from "./mutation.js";
import type { QueryService } from "./query.js";
import { wireValue } from "./read-budget.js";
import { readOperation } from "./read-operation.js";

const builtinTimestamp = "2026-01-01T00:00:00.000Z";
type Author = NonNullable<DashboardSummary["created_by"]>;
type Client = Prisma.TransactionClient;
/** One dashboard, shipped or saved, in the shape every presentation starts from. */
interface Entry {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  revision: number;
  builtin: boolean;
  isDefault: boolean;
  /** Null for a built-in, which nobody can edit. */
  createdByUserId: string | null;
  /** Parsed once; null when a saved row no longer matches the definition schema. */
  definition: DashboardDefinition | null;
  createdAt: string;
  updatedAt: string;
}
function fromRow(
  row: DashboardRow,
  definition: DashboardDefinition | null = parseDefinition(row.definition),
): Entry {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    description: row.description,
    revision: row.revision,
    builtin: false,
    isDefault: row.isDefault,
    createdByUserId: row.createdByUserId,
    definition,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
function fromBuiltin(
  dashboard: BuiltinDashboard,
  caller: CallerContext,
): Entry {
  return {
    id: dashboard.id,
    organizationId: caller.organizationId,
    name: dashboard.name,
    description: dashboard.description,
    revision: 0,
    builtin: true,
    isDefault: false,
    createdByUserId: null,
    definition: dashboard.definition,
    createdAt: builtinTimestamp,
    updatedAt: builtinTimestamp,
  };
}
function parseDefinition(value: unknown): DashboardDefinition | null {
  const parsed = dashboardDefinitionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
function canEdit(caller: CallerContext, entry: Entry): boolean {
  return (
    entry.createdByUserId !== null &&
    (entry.createdByUserId === caller.userId || hasAdminAuthority(caller))
  );
}
// Self-contained for agents (no $ref/$defs, which some model APIs reject): an empty
// metadata registry keeps the OpenAPI component ids out of it.
const definitionJsonSchema = z.toJSONSchema(dashboardDefinitionSchema, {
  io: "input",
  metadata: z.registry(),
});

/**
 * Rendered tiles live at most an hour, keyed by organization, caller scope, dashboard
 * revision, resolved variables and the organization's published-session version, one
 * entry per tile (§10). The version counts published, purged and private sessions, so a
 * newly published session misses while messages added to a published session do not
 * (ADR 0064; ADR 0058 had dropped the activity-based data version because it moved
 * every few seconds). The hourly pre-render job replaces entries before they expire.
 */
const sessionVersionSchema = z.object({
  published: z.number().int().nonnegative(),
  purged: z.number().int().nonnegative(),
  hidden: z.number().int().nonnegative(),
});
const RENDER_CACHE_TTL_MS = 60 * 60_000;
/** Dashboards kept at once; the earliest inserted is evicted first. */
const RENDER_CACHE_DASHBOARDS = 256;
const RENDER_CONCURRENCY = 4;
interface RenderedTile {
  tile: DashboardTileResult;
  renderedAt: string;
}
interface CachedTile extends RenderedTile {
  expiresAt: number;
}
interface CachedDashboard {
  insertedAt: number;
  tiles: Map<string, CachedTile>;
}
/** Per-tile results of saved and built-in dashboards; errored tiles are never stored. */
class RenderCache {
  private readonly dashboards = new Map<string, CachedDashboard>();
  /** The unexpired tiles cached under `key`. */
  get(key: string, now: number): ReadonlyMap<string, CachedTile> {
    const entry = this.dashboards.get(key);
    if (!entry) return new Map();
    for (const [id, tile] of entry.tiles)
      if (tile.expiresAt <= now) entry.tiles.delete(id);
    if (!entry.tiles.size) this.dashboards.delete(key);
    return entry.tiles;
  }
  /** Store or replace tiles under `key`; when full, the earliest inserted dashboard goes first. */
  set(key: string, tiles: readonly CachedTile[], now: number): void {
    if (!tiles.length) return;
    let entry = this.dashboards.get(key);
    if (!entry) {
      if (this.dashboards.size >= RENDER_CACHE_DASHBOARDS) {
        let oldest: [string, CachedDashboard] | undefined;
        for (const candidate of this.dashboards)
          if (!oldest || candidate[1].insertedAt < oldest[1].insertedAt)
            oldest = candidate;
        if (oldest) this.dashboards.delete(oldest[0]);
      }
      entry = { insertedAt: now, tiles: new Map() };
      this.dashboards.set(key, entry);
    }
    for (const tile of tiles) entry.tiles.set(tile.tile.id, tile);
  }
}
/** Admins share one cache scope; each member has their own because row policies show them their private sessions. */
export function renderScope(caller: CallerContext): string {
  return hasAdminAuthority(caller) ? "admin" : `user:${caller.userId}`;
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
export class DashboardService {
  private readonly cache = new RenderCache();
  constructor(
    private readonly dependencies: {
      prisma: PrismaClient;
      audit: AuditService;
      query: QueryService;
    },
  ) {}

  private async authors(
    client: Client,
    ids: readonly string[],
  ): Promise<Map<string, Author>> {
    if (!ids.length) return new Map();
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
    entry: Entry,
    caller: CallerContext,
    defaultId: string,
    authors: Map<string, Author>,
  ): DashboardSummary {
    return {
      id: entry.id,
      organization_id: entry.organizationId,
      name: entry.name,
      description: entry.description,
      revision: entry.revision,
      builtin: entry.builtin,
      is_default: entry.id === defaultId,
      can_edit: canEdit(caller, entry),
      created_by:
        entry.createdByUserId === null
          ? null
          : (authors.get(entry.createdByUserId) ?? {
              user_id: entry.createdByUserId,
              email: null,
              name: null,
            }),
      tile_count: entry.definition?.tiles.length ?? 0,
      created_at: entry.createdAt,
      updated_at: entry.updatedAt,
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
    const entry = await this.entry(
      this.dependencies.prisma,
      caller,
      z.string().parse(request.id),
    );
    return { definition: this.definitionOf(entry), revision: entry.revision };
  }
  /** A built-in by id, or the organization's saved row. */
  private async entry(
    client: Client,
    caller: CallerContext,
    id: string,
  ): Promise<Entry> {
    const builtin = builtinDashboard(id);
    return builtin
      ? fromBuiltin(builtin, caller)
      : fromRow(await this.find(client, caller, id));
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
  private definitionOf(entry: Entry): DashboardDefinition {
    if (entry.definition === null)
      throw new ServiceError(
        409,
        "DASHBOARD_INVALID",
        "This dashboard was saved in an older format. Delete it or ask an admin to recreate it.",
      );
    return entry.definition;
  }
  private async present(client: Client, caller: CallerContext, entry: Entry) {
    const definition = this.definitionOf(entry);
    const [defaultId, authors] = await Promise.all([
      this.defaultId(client, caller.organizationId),
      this.authors(
        client,
        entry.createdByUserId === null ? [] : [entry.createdByUserId],
      ),
    ]);
    return dashboardSchema.parse({
      ...this.summary(entry, caller, defaultId, authors),
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
              fromBuiltin(dashboard, caller),
            ),
            ...rows.map((row) => fromRow(row)),
          ].map((entry) => this.summary(entry, caller, defaultId, authors)),
          default_id: defaultId,
          definition_schema: definitionJsonSchema,
          templates: dashboardTileTemplates,
        });
      },
      {
        describeResult: (result) => ({ dashboards: result.items.length }),
      },
    );
  }

  get(context: ServiceContext, input: unknown) {
    return readOperation(
      this.dependencies.audit,
      context,
      { action: "dashboard.get", resourceType: "dashboard" },
      async (caller) => {
        const { id } = dashboardIdInputSchema.parse(input);
        const client = this.dependencies.prisma;
        return this.present(
          client,
          caller,
          await this.entry(client, caller, id),
        );
      },
      {
        describeResources: (result) => [result.id],
      },
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
        await lockOrganization(tx, caller);
        const existing = request.id
          ? fromRow(await this.find(tx, caller, request.id))
          : null;
        if (existing && !canEdit(caller, existing))
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
          wireValue({
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
        let embeddings: EmbeddingAvailability | undefined;
        for (const tile of content.definition.tiles) {
          if (!("sql" in tile)) continue;
          embeddings ??= await this.dependencies.query.embeddingsEnabled(
            caller,
            tx,
          );
          try {
            await this.dependencies.query.guard(caller, tile.sql, {
              parameterTypes: types,
              embeddings,
            });
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
          result: await this.present(
            tx,
            caller,
            fromRow(row, content.definition),
          ),
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
        const entry = fromRow(await this.find(tx, caller, id));
        if (!canEdit(caller, entry))
          throw new ServiceError(
            403,
            "DASHBOARD_FORBIDDEN",
            "Only the person who created this dashboard or an organization admin can delete it.",
          );
        await tx.dashboard.delete({ where: { id: entry.id } });
        return {
          result: dashboardDeleteOutputSchema.parse({ deleted: true }),
          resourceIds: [id],
          detail: { was_default: entry.isDefault },
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
        await lockOrganization(tx, caller);
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
    let target: string | undefined;
    return readOperation(
      this.dependencies.audit,
      context,
      {
        action: "dashboard.render",
        resourceType: "dashboard",
        detail: input ?? null,
      },
      async (caller) => {
        const request = dashboardRenderInputSchema.parse(input);
        target = request.id;
        const { definition, revision } = await this.source(caller, request);
        const wanted = request.tiles && new Set(request.tiles);
        const selected = wanted
          ? definition.tiles.filter((tile) => wanted.has(tile.id))
          : definition.tiles;
        const known = new Set(definition.tiles.map((tile) => tile.id));
        const unknown = request.tiles?.filter((id) => !known.has(id)) ?? [];
        if (unknown.length)
          throw new ServiceError(
            400,
            "DASHBOARD_TILE_UNKNOWN",
            `This dashboard has no tile named ${unknown.join(", ")}.`,
          );
        return this.renderTiles(caller, {
          definition,
          tiles: selected,
          variables: request.variables,
          // Inline definitions (editor previews) are never cached.
          cacheId:
            request.id === undefined ? null : { id: request.id, revision },
          refresh: request.refresh,
        });
      },
      {
        describeResult: (result) => ({
          tiles: result.tiles.length,
          errors: result.tiles.filter((tile) => tile.error !== null).length,
          cached: result.cached,
        }),
        describeResources: () => (target ? [target] : []),
      },
    );
  }

  /**
   * Run the data tiles among `tiles` that the cache does not hold (all of them on
   * `refresh` or for an inline definition), cache the successful runs under the
   * dashboard's key and report `rendered_at` as the oldest returned tile's run time;
   * `cached` is true when no tile ran. An errored tile is returned but never cached, so
   * the next request retries it alone.
   */
  private async renderTiles(
    caller: CallerContext,
    plan: {
      definition: DashboardDefinition;
      tiles: readonly DashboardTile[];
      variables: Readonly<Record<string, DashboardVariableValue>>;
      /** The saved or built-in dashboard the entry belongs to; null for inline definitions. */
      cacheId: { id: string; revision: number } | null;
      refresh: boolean;
    },
  ): Promise<DashboardRenderOutput> {
    const { parameters, resolved } = resolveDashboardVariables(
      plan.definition.variables,
      plan.variables,
    );
    const parameterTypes = dashboardParameterTypes(plan.definition.variables);
    const cacheKey =
      plan.cacheId === null
        ? null
        : JSON.stringify([
            caller.organizationId,
            renderScope(caller),
            plan.cacheId.id,
            plan.cacheId.revision,
            resolved,
            await this.sessionVersion(caller.organizationId),
          ]);
    const now = Date.now();
    const cached =
      cacheKey === null || plan.refresh
        ? new Map<string, CachedTile>()
        : this.cache.get(cacheKey, now);
    const data = plan.tiles.filter((tile) => "sql" in tile);
    const pending = data.filter((tile) => !cached.has(tile.id));
    const fresh = pending.length
      ? await this.runTiles(caller, pending, parameters, parameterTypes)
      : [];
    const renderedAt = new Date().toISOString();
    if (cacheKey !== null)
      this.cache.set(
        cacheKey,
        fresh
          .filter((tile) => tile.error === null)
          .map((tile) => ({
            tile,
            renderedAt,
            expiresAt: Date.now() + RENDER_CACHE_TTL_MS,
          })),
        now,
      );
    const results = new Map<string, RenderedTile>(cached);
    for (const tile of fresh) results.set(tile.id, { tile, renderedAt });
    const tiles = data.flatMap((tile) => {
      const entry = results.get(tile.id);
      return entry ? [entry] : [];
    });
    return dashboardRenderOutputSchema.parse({
      tiles: tiles.map((entry) => entry.tile),
      variables: resolved,
      rendered_at: tiles.reduce(
        (oldest, entry) =>
          entry.renderedAt < oldest ? entry.renderedAt : oldest,
        renderedAt,
      ),
      cached: data.length > 0 && pending.length === 0,
    });
  }

  /**
   * The organization's published-session version for the render cache key (ADR 0064):
   * counts of published unpurged, purged and private sessions from the control plane, one
   * indexed PostgreSQL aggregate. A newly published session, a purge or a visibility change
   * misses; messages added to an already published session do not move it.
   */
  private async sessionVersion(organizationId: string): Promise<string> {
    const rows = await this.dependencies.prisma.$queryRaw<
      unknown[]
    >`SELECT count(*) FILTER (WHERE published_revision > 0 AND purged_at IS NULL)::int AS published, count(*) FILTER (WHERE purged_at IS NOT NULL)::int AS purged, count(*) FILTER (WHERE visibility = 'PRIVATE')::int AS hidden FROM trace_session_control WHERE organization_id = ${organizationId}`;
    const counts = sessionVersionSchema.parse(rows[0] ?? {});
    return `${String(counts.published)}/${String(counts.purged)}/${String(counts.hidden)}`;
  }

  /**
   * Run data tiles four at a time; a tile's error is its result, never the request's.
   * Tiles with identical SQL share one run, so several stats reading columns of the same
   * aggregate row cost one scan.
   */
  private async runTiles(
    caller: CallerContext,
    tiles: readonly Extract<DashboardTile, { sql: string }>[],
    parameters: TraceParameters,
    parameterTypes: Readonly<Record<string, string>>,
  ): Promise<DashboardTileResult[]> {
    // Availability cannot change between the tiles of one request.
    const embeddings = await this.dependencies.query.embeddingsEnabled(caller);
    const statements = [...new Set(tiles.map((tile) => tile.sql))];
    const outcomes = new Map(
      await concurrently(
        statements,
        RENDER_CONCURRENCY,
        async (
          sql,
        ): Promise<[string, Pick<DashboardTileResult, "result" | "error">]> => {
          try {
            return [
              sql,
              {
                result: await this.dependencies.query.run(caller, {
                  sql,
                  parameters,
                  parameterTypes,
                  embeddings,
                }),
                error: null,
              },
            ];
          } catch (error) {
            if (!(error instanceof ServiceError)) throw error;
            return [
              sql,
              {
                result: null,
                error: { code: error.code, message: error.message },
              },
            ];
          }
        },
      ),
    );
    return tiles.map((tile) => ({
      id: tile.id,
      ...(outcomes.get(tile.sql) ?? { result: null, error: null }),
    }));
  }

  /**
   * Re-render the default dashboard and every saved dashboard for one caller with their
   * default variables, the values a page opens with, replacing the cached tiles. The
   * pre-render job calls this for recently active scopes and audits each run (§10).
   */
  async prerender(
    caller: CallerContext,
  ): Promise<{ dashboards: string[]; tiles: number; errors: number }> {
    const rows = await this.dependencies.prisma.dashboard.findMany({
      where: { organizationId: caller.organizationId },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }, { id: "asc" }],
      take: dashboardSavedLimit,
    });
    const entries = [
      ...(rows.some((row) => row.isDefault)
        ? []
        : [fromBuiltin(teamOverviewDashboard, caller)]),
      ...rows.map((row) => fromRow(row)),
    ];
    const summary = { dashboards: new Array<string>(), tiles: 0, errors: 0 };
    for (const entry of entries) {
      // A row in an older format renders as DASHBOARD_INVALID; nothing to pre-render.
      if (entry.definition === null) continue;
      const output = await this.renderTiles(caller, {
        definition: entry.definition,
        tiles: entry.definition.tiles,
        variables: {},
        cacheId: { id: entry.id, revision: entry.revision },
        refresh: true,
      });
      summary.dashboards.push(entry.id);
      summary.tiles += output.tiles.length;
      summary.errors += output.tiles.filter(
        (tile) => tile.error !== null,
      ).length;
    }
    return summary;
  }
}
