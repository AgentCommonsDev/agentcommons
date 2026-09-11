import { z } from "zod";
import {
  ToolSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { CallerContext, KeyToolGroup } from "@agentcommons/core";
import * as schema from "@agentcommons/core/schemas";
import {
  formatSearch,
  formatGet,
  formatSql,
  formatJson,
  formatDashboard,
  formatDashboardList,
  formatDashboardRender,
  governingSentence,
  serverInstructions,
  toolDescriptions,
  type Formatted,
} from "@agentcommons/core/format";
import type { Services } from "../routes/services.js";
import { auditedOperation } from "./audit.js";
import {
  requireCaller,
  requirePermission,
  ServiceError,
  type ServiceContext,
  type ServiceResult,
} from "./context.js";
import { hasAdminAuthority } from "@agentcommons/db";

const dashboardInstruction =
  "Use this when the user asks to view, build or change dashboards.";
/**
 * The read tools' text and the server `instructions` returned by `initialize` (§8.2) live
 * in core, where a unit test parses each description's worked example with the call
 * schema and measures its bytes (ADR 0070).
 */
export { serverInstructions };
/**
 * The default catalog: what every `sessions:read` key lists, in `tools/list` order. Nothing
 * else is exposed unless the key opts in (§8.2); the constructor checks the registry agrees.
 */
export const readToolNames = ["search", "get", "sql"] as const;
/** Listed after the read tools when the key grants the `dashboards` tool group. */
export const dashboardToolNames = [
  "dashboard_list",
  "dashboard_get",
  "dashboard_render",
  "dashboard_save",
  "dashboard_delete",
] as const;
/** Listed next for effective admin authority, whatever the key's tool groups. */
export const adminToolNames = [
  "set_visibility",
  "purge",
  "audit",
  "status",
] as const;
/** Listed last: admin authority and the `dashboards` tool group together. */
export const dashboardAdminToolNames = ["dashboard_set_default"] as const;
interface Definition<
  I extends z.ZodType = z.ZodType,
  O extends z.ZodType = z.ZodType,
> {
  name: string;
  description: string;
  permission: "read" | "admin";
  /**
   * Opt-in tool group (§8.2): listed and callable only when the key's `tools` permission
   * names it. Tools without a group form the default catalog.
   */
  group?: KeyToolGroup;
  /** Strict schema every call is parsed with. */
  input: I;
  /** Compact rendering advertised in `tools/list` when it differs from `input` (§8.2). */
  toolInput?: z.ZodType;
  /** Parsed once per call at this boundary; `format` then renders the typed value. */
  output: O;
  destructive: boolean;
  readOnly: boolean;
  instruction?: string;
  /** Rate-limit category the adapter applies before the call; reads by default. */
  rate?: "sql" | "read";
  execute(
    context: ServiceContext,
    input: z.output<I>,
  ): Promise<ServiceResult<unknown>>;
  /** Renders the text form; `input` lets a formatter know what was asked (a continuation page). */
  format(value: z.output<O>, input: z.output<I>): Formatted<z.output<O>>;
}
/** Types one tool's input and output from its schemas; the catalog holds the erased form. */
const define = <I extends z.ZodType, O extends z.ZodType>(
  definition: Definition<I, O>,
): Definition => definition;
/**
 * Tool-facing JSON Schema for the catalog: the shared zod contract without the draft
 * URL or regex patterns that only restate a `format`. Claude Code defers every MCP tool
 * behind a search step once the catalog nears its budget, so `tools/list` stays small
 * (§8.2) while calls are still validated by the full zod schema.
 */
export function toolJsonSchema(input: z.ZodType): Record<string, unknown> {
  const rendered = z.toJSONSchema(input, {
    io: "input",
    override: (context) => {
      if (typeof context.jsonSchema.format === "string")
        delete context.jsonSchema.pattern;
    },
  });
  delete rendered.$schema;
  return rendered;
}
export class McpService {
  /** The static catalog: each definition with the `Tool` it is listed as, built once. */
  private readonly tools: readonly { definition: Definition; tool: Tool }[];
  constructor(private readonly services: Services) {
    const definitions: Definition[] = [
      define({
        name: "search",
        description: toolDescriptions.search,
        permission: "read",
        readOnly: true,
        destructive: false,
        input: schema.searchInputSchema,
        toolInput: schema.searchToolInputSchema,
        output: schema.searchOutputSchema,
        execute: (ctx, input) => services.search.execute(ctx, input),
        format: formatSearch,
      }),
      define({
        name: "get",
        description: toolDescriptions.get,
        permission: "read",
        readOnly: true,
        destructive: false,
        input: schema.getInputSchema,
        toolInput: schema.getToolInputSchema,
        output: schema.getOutputSchema,
        execute: (ctx, input) => services.sessions.get(ctx, input),
        format: (result, input) =>
          formatGet(result, {
            continuation: input.cursor !== null && input.cursor !== undefined,
          }),
      }),
      define({
        name: "sql",
        description: toolDescriptions.sql,
        permission: "read",
        readOnly: true,
        destructive: false,
        rate: "sql",
        input: schema.sqlInputSchema,
        output: schema.sqlOutputSchema,
        execute: (ctx, input) => services.query.execute(ctx, input),
        format: formatSql,
      }),
      define({
        name: "dashboard_list",
        instruction: dashboardInstruction,
        group: "dashboards",
        readOnly: true,
        destructive: false,
        description:
          "List the organization's dashboards (id, name, tile count, flags, updated_at, description), which one is the Home default and the starter tile template ids; read a definition with dashboard_get. Two built-ins always exist: Team overview (captured sessions, search adoption and reuse; the default until an admin picks another) and Team activity (sessions, messages, tool calls, repositories and coding tools per person, for managers). The definition JSON Schema travels as structuredContent.definition_schema.",
        permission: "read",
        input: schema.emptySchema,
        output: schema.dashboardListOutputSchema,
        execute: (ctx) => services.dashboards.list(ctx),
        format: formatDashboardList,
      }),
      define({
        name: "dashboard_get",
        instruction: dashboardInstruction,
        group: "dashboards",
        readOnly: true,
        destructive: false,
        description:
          "Read one dashboard by id with its full definition: variables, tiles, SQL, layout and chart options.",
        permission: "read",
        input: schema.dashboardIdInputSchema,
        output: schema.dashboardSchema,
        execute: (ctx, input) => services.dashboards.get(ctx, input),
        format: formatDashboard,
      }),
      define({
        name: "dashboard_render",
        instruction: dashboardInstruction,
        group: "dashboards",
        readOnly: true,
        destructive: false,
        description:
          'Run the queries of a dashboard (by id or an inline definition) with variable values such as {"time_range":"7d","repo":["github.com/org/repo"]} and return each tile\'s rows. Pass tiles to render a subset. Saved dashboards are served from a cache that a newly published session invalidates; the result says when it was rendered and whether it came from the cache, and refresh: true re-runs the tiles.',
        permission: "read",
        input: schema.dashboardRenderInputSchema,
        toolInput: schema.dashboardRenderToolInputSchema,
        output: schema.dashboardRenderOutputSchema,
        execute: (ctx, input) => services.dashboards.render(ctx, input),
        format: (result) => formatDashboardRender(result),
      }),
      define({
        name: "dashboard_save",
        instruction: dashboardInstruction,
        group: "dashboards",
        readOnly: false,
        destructive: false,
        description:
          "Create or update a dashboard everyone in the organization can see. Start from dashboard_list templates, validate with dashboard_render on an inline definition, then save. Updates need id and revision; only the creator or an organization admin can change a saved dashboard.",
        permission: "read",
        input: schema.dashboardSaveInputSchema,
        toolInput: schema.dashboardSaveToolInputSchema,
        output: schema.dashboardSchema,
        execute: (ctx, input) => services.dashboards.save(ctx, input),
        format: formatDashboard,
      }),
      define({
        name: "dashboard_delete",
        instruction: dashboardInstruction,
        group: "dashboards",
        readOnly: false,
        destructive: true,
        description:
          "Delete a saved dashboard. Creators can delete their own; organization admins can delete any.",
        permission: "read",
        input: schema.dashboardIdInputSchema,
        output: schema.dashboardDeleteOutputSchema,
        execute: (ctx, input) => services.dashboards.delete(ctx, input),
        format: formatJson,
      }),
      define({
        name: "set_visibility",
        description:
          "Change session visibility between PUBLIC and PRIVATE with a reason. Private sessions are visible to organization admins only.",
        permission: "admin",
        readOnly: false,
        destructive: false,
        input: schema.visibilityInputSchema,
        output: schema.mutationOutputSchema,
        execute: (ctx, input) => services.admin.setVisibility(ctx, input),
        format: formatJson,
      }),
      define({
        name: "purge",
        description:
          "Permanently remove session contents and retain its tombstone. Supply a reason.",
        permission: "admin",
        readOnly: false,
        destructive: true,
        input: schema.purgeInputSchema,
        output: schema.purgeOutputSchema,
        execute: (ctx, input) => services.admin.purge(ctx, input),
        format: formatJson,
      }),
      define({
        name: "audit",
        description:
          "Read this organization's audit events using exact identifiers and UTC time bounds.",
        permission: "admin",
        readOnly: true,
        destructive: false,
        input: schema.auditInputSchema,
        output: schema.auditOutputSchema,
        execute: (ctx, input) => services.admin.auditLog(ctx, input),
        format: formatJson,
      }),
      define({
        name: "status",
        description:
          "Read this organization's ingestion, redaction, and background job status.",
        permission: "admin",
        readOnly: true,
        destructive: false,
        input: schema.emptySchema,
        output: schema.statusOutputSchema,
        execute: (ctx) => services.admin.status(ctx),
        format: formatJson,
      }),
      define({
        name: "dashboard_set_default",
        instruction: dashboardInstruction,
        group: "dashboards",
        readOnly: false,
        destructive: false,
        description:
          "Make a saved dashboard the organization's Home default. Pass the built-in Team overview's id to restore the shipped default; other built-ins must be duplicated first.",
        permission: "admin",
        input: schema.dashboardIdInputSchema,
        output: schema.dashboardDefaultOutputSchema,
        execute: (ctx, input) => services.dashboards.setDefault(ctx, input),
        format: formatJson,
      }),
    ];
    const listed = (
      permission: Definition["permission"],
      group: Definition["group"],
    ) =>
      definitions
        .filter(
          (definition) =>
            definition.permission === permission && definition.group === group,
        )
        .map((definition) => definition.name)
        .join();
    if (
      definitions.map((definition) => definition.name).join() !==
        [
          ...readToolNames,
          ...dashboardToolNames,
          ...adminToolNames,
          ...dashboardAdminToolNames,
        ].join() ||
      listed("read", undefined) !== readToolNames.join() ||
      listed("read", "dashboards") !== dashboardToolNames.join() ||
      listed("admin", undefined) !== adminToolNames.join() ||
      listed("admin", "dashboards") !== dashboardAdminToolNames.join()
    )
      throw new Error("The MCP catalog and its exported tool names disagree.");
    this.tools = definitions.map((definition) => ({
      definition,
      tool: ToolSchema.parse({
        name: definition.name,
        description: `${definition.instruction ?? governingSentence} ${definition.description}`,
        inputSchema: toolJsonSchema(definition.toolInput ?? definition.input),
        annotations: {
          readOnlyHint: definition.readOnly,
          destructiveHint: definition.destructive,
          openWorldHint: false,
        },
      }),
    }));
  }
  private async current(context: ServiceContext): Promise<ServiceContext> {
    const identity = await this.services.auth.authenticate(
      context.headers,
      context,
    );
    if (
      identity.caller?.authMethod !== "key" ||
      !/^Bearer \S+$/i.test(context.headers.get("authorization") ?? "")
    )
      throw new ServiceError(
        401,
        "BEARER_REQUIRED",
        "Use an organization bearer API key for MCP.",
      );
    return { ...context, caller: identity.caller, principal: identity };
  }
  /** Whether the key's `tools` grant names the definition's opt-in group; ungrouped tools need none. */
  private granted(caller: CallerContext, definition: Definition): boolean {
    return (
      definition.group === undefined ||
      caller.permissions.tools?.includes(definition.group) === true
    );
  }
  /**
   * The permission-filtered catalog a caller sees: the read tools for `sessions:read`, each
   * opt-in group only when the key grants it, admin tools only with effective admin
   * authority (§8.2). Output schemas stay server-side: results still carry
   * `structuredContent`, and shipping them would triple the payload.
   */
  catalog(caller: CallerContext | null): Tool[] {
    if (!caller || caller.toolsEnabled === false) return [];
    return this.tools
      .filter(
        ({ definition }) =>
          this.granted(caller, definition) &&
          (definition.permission === "admin"
            ? hasAdminAuthority(caller)
            : caller.permissions.sessions?.includes("read") === true),
      )
      .map(({ tool }) => tool);
  }
  list(context: ServiceContext) {
    return auditedOperation(
      this.services.audit,
      context,
      { action: "mcp.tools.list" },
      async () => {
        const current = await this.current(context);
        const tools = this.catalog(current.caller);
        return {
          result: { tools },
          audit: await this.services.audit.write(current, {
            action: "mcp.tools.list",
            detail: { tool_names: tools.map((tool) => tool.name) },
          }),
        };
      },
    );
  }
  async control(
    context: ServiceContext,
    method: string,
    outcome: {
      statusCode: number;
      protocolError: { code: number; message: string } | null;
    },
  ): Promise<void> {
    await this.services.audit.write(context, {
      action: "mcp.protocol",
      statusCode: outcome.statusCode,
      detail: { method, protocol_error: outcome.protocolError },
    });
  }
  async call(
    context: ServiceContext,
    name: string,
    input: unknown,
    before?: (rate: "sql" | "read") => Promise<void>,
  ): Promise<CallToolResult> {
    try {
      return await auditedOperation(
        this.services.audit,
        context,
        { action: "mcp.call", detail: { name } },
        async () => {
          const definition = this.tools.find(
            (tool) => tool.definition.name === name,
          )?.definition;
          await before?.(definition?.rate ?? "read");
          const current = await this.current(context);
          if (current.caller?.toolsEnabled === false)
            throw new ServiceError(
              403,
              "INSTALLATION_TOOLS_DISABLED",
              "MCP tools are disabled for this installation. Capture remains enabled.",
            );
          if (!definition)
            throw new ServiceError(
              404,
              "UNKNOWN_TOOL",
              "This MCP tool is not available.",
            );
          // The same gate as the catalog: a cached client cannot call a tool its key does
          // not expose, and the message names the permission that would.
          if (!this.granted(requireCaller(current), definition))
            throw new ServiceError(
              403,
              "TOOL_NOT_GRANTED",
              `This key does not grant the ${String(definition.group)} tools. Create a key with that tool permission.`,
            );
          requirePermission(current, definition.permission);
          // A call satisfies the advertised schema first: fields the catalog does not
          // show (the REST page budget, the CSV format) are not open to agents.
          const args = input ?? {};
          definition.toolInput?.parse(args);
          const parsed = definition.input.parse(args);
          const value = await definition.execute(current, parsed);
          const formatted = definition.format(
            definition.output.parse(value.result),
            parsed,
          );
          return {
            content: [{ type: "text" as const, text: formatted.text }],
            structuredContent: z
              .record(z.string(), z.unknown())
              .parse(formatted.structuredContent),
          };
        },
      );
    } catch (error) {
      if (!(error instanceof ServiceError)) throw error;
      const value = schema.errorSchema.parse({
        code: error.code,
        message: error.message,
        detail: error.detail,
      });
      return {
        isError: true,
        content: [{ type: "text", text: JSON.stringify(value) }],
      };
    }
  }
}
