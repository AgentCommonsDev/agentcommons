import { z } from "zod";
import {
  ToolSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { CallerContext } from "@agentcommons/core";
import * as schema from "@agentcommons/core/schemas";
import {
  formatSearch,
  formatGet,
  formatSql,
  formatJson,
} from "@agentcommons/core/format";
import type { Services } from "../routes/services.js";
import { auditedOperation } from "./audit.js";
import {
  requirePermission,
  ServiceError,
  type ServiceContext,
  type ServiceResult,
} from "./context.js";
import { hasAdminAuthority } from "@agentcommons/db";

const dashboardInstruction =
  "Use this when the user asks to view, build or change dashboards.";
const governingSentence =
  "Only use this when the user asks about previous sessions or prior work; where possible run multi-step investigation in a subagent that returns only findings with session ids.";
interface Definition {
  name: string;
  description: string;
  permission: "read" | "admin";
  /** Strict schema every call is parsed with. */
  input: z.ZodType;
  /** Compact rendering advertised in `tools/list` when it differs from `input` (§8.2). */
  toolInput?: z.ZodType;
  output: z.ZodType;
  destructive?: boolean;
  readOnly?: boolean;
  instruction?: string;
  execute(
    context: ServiceContext,
    input: unknown,
  ): Promise<ServiceResult<unknown>>;
  format(value: unknown): { text: string; structuredContent: unknown };
}
const json = (value: unknown) =>
  formatJson(schema.jsonValueSchema.parse(value));
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
  private readonly definitions: Definition[];
  constructor(private readonly services: Services) {
    this.definitions = [
      {
        name: "dashboard_list",
        instruction: dashboardInstruction,
        readOnly: true,
        description:
          "List the organization's dashboards, which one is the Home default, the JSON Schema for definitions and starter tile templates. Two built-ins always exist: Team overview (captured sessions, search adoption and reuse; the default until an admin picks another) and Team activity (sessions, messages, tool calls, repositories and coding tools per person, for managers).",
        permission: "read",
        input: z.strictObject({}),
        output: schema.dashboardListOutputSchema,
        execute: (ctx) => services.dashboards.list(ctx),
        format: json,
      },
      {
        name: "dashboard_get",
        instruction: dashboardInstruction,
        readOnly: true,
        description:
          "Read one dashboard by id with its full definition: variables, tiles, SQL, layout and chart options.",
        permission: "read",
        input: schema.dashboardIdInputSchema,
        output: schema.dashboardSchema,
        execute: (ctx, input) => services.dashboards.get(ctx, input),
        format: json,
      },
      {
        name: "dashboard_render",
        instruction: dashboardInstruction,
        readOnly: true,
        description:
          'Run the queries of a dashboard (by id or an inline definition) with variable values such as {"time_range":"7d","repo":["github.com/org/repo"]} and return each tile\'s rows. Pass tiles to render a subset.',
        permission: "read",
        input: schema.dashboardRenderInputSchema,
        toolInput: schema.dashboardRenderToolInputSchema,
        output: schema.dashboardRenderOutputSchema,
        execute: (ctx, input) => services.dashboards.render(ctx, input),
        format: json,
      },
      {
        name: "dashboard_save",
        instruction: dashboardInstruction,
        readOnly: false,
        description:
          "Create or update a dashboard everyone in the organization can see. Start from dashboard_list templates, validate with dashboard_render on an inline definition, then save. Updates need id and revision; only the creator or an organization admin can change a saved dashboard.",
        permission: "read",
        input: schema.dashboardSaveInputSchema,
        toolInput: schema.dashboardSaveToolInputSchema,
        output: schema.dashboardSchema,
        execute: (ctx, input) => services.dashboards.save(ctx, input),
        format: json,
      },
      {
        name: "dashboard_delete",
        instruction: dashboardInstruction,
        readOnly: false,
        destructive: true,
        description:
          "Delete a saved dashboard. Creators can delete their own; organization admins can delete any.",
        permission: "read",
        input: schema.dashboardIdInputSchema,
        output: schema.dashboardDeleteOutputSchema,
        execute: (ctx, input) => services.dashboards.delete(ctx, input),
        format: json,
      },
      {
        name: "search",
        description:
          'Search previous coding-agent messages with words and structured filters. All query tokens must match; English inflections share a stem. Results are message windows grouped by session; follow up with get (session_id, seq) or sql. Each filter takes one value or a list (any of), all filters must hold, and the input schema states what each one means. Example, sessions that edited a file under src/auth/: {"query":"","filters":{"file_prefix":"src/auth/","file_operation":"edit"}}.',
        permission: "read",
        input: schema.searchInputSchema,
        toolInput: schema.searchToolInputSchema,
        output: schema.searchOutputSchema,
        execute: (ctx, input) => services.search.execute(ctx, input),
        format: (value) => formatSearch(schema.searchOutputSchema.parse(value)),
      },
      {
        name: "get",
        description:
          'Read one session by session_id: a header (who ran it, harness, model, repository, branch, start, end, status, message, tool call, token, file, commit and reuse counts, tools_used, root_session_id, parent and child sessions) and its messages in seq order with role, kind, tool_name, tool_use_id and content. Each child ref carries parent_tool_use_id, the tool_use_id of the TOOL_USE message here that spawned it (null when unrecorded), so a subagent run reads in place under its call. Bound a range with from/to; when next is not null, pass it as cursor. Example: {"session_id":"<uuid>","from":0,"to":40}.',
        permission: "read",
        input: schema.getInputSchema,
        output: schema.getOutputSchema,
        execute: (ctx, input) => services.sessions.get(ctx, input),
        format: (value) => formatGet(schema.getOutputSchema.parse(value)),
      },
      {
        name: "sql",
        description:
          "Run one read-only ClickHouse SELECT over api_ro. Views: sessions (session metadata); messages (normalized messages); session_files (observed files); session_observed_commits (commit observations); session_tools (tool counts); users (visible contributors); installations (visible devices); repos (visible repository counts); schema_columns (column descriptions); schema_functions (function descriptions). search_messages(q='words') returns uncapped session_id,seq,rank. Discover columns with SELECT * FROM schema_columns WHERE view_name = 'sessions' and every table function this organization can use with SELECT * FROM schema_functions. Limits: 500 rows, 5 seconds.",
        permission: "read",
        input: schema.sqlInputSchema,
        output: schema.sqlOutputSchema,
        execute: (ctx, input) => services.query.execute(ctx, input),
        format: (value) => formatSql(schema.sqlOutputSchema.parse(value)),
      },
      {
        name: "set_visibility",
        description:
          "Change session visibility between PUBLIC and PRIVATE with a reason. Private sessions are visible to organization admins only.",
        permission: "admin",
        input: schema.visibilityInputSchema,
        output: schema.mutationOutputSchema,
        execute: (ctx, input) => services.admin.setVisibility(ctx, input),
        format: json,
      },
      {
        name: "purge",
        description:
          "Permanently remove session contents and retain its tombstone. Supply a reason.",
        permission: "admin",
        input: schema.purgeInputSchema,
        output: schema.purgeOutputSchema,
        destructive: true,
        execute: (ctx, input) => services.admin.purge(ctx, input),
        format: json,
      },
      {
        name: "audit",
        description:
          "Read this organization's audit events using exact identifiers and UTC time bounds.",
        permission: "admin",
        input: schema.auditInputSchema,
        output: schema.auditOutputSchema,
        execute: (ctx, input) => services.admin.auditLog(ctx, input),
        format: json,
      },
      {
        name: "status",
        description:
          "Read this organization's ingestion, redaction, and background job status.",
        permission: "admin",
        input: z.strictObject({}),
        output: schema.statusOutputSchema,
        execute: (ctx) => services.admin.status(ctx),
        format: json,
      },
      {
        name: "dashboard_set_default",
        instruction: dashboardInstruction,
        readOnly: false,
        description:
          "Make a saved dashboard the organization's Home default. Pass the built-in Team overview's id to restore the shipped default; other built-ins must be duplicated first.",
        permission: "admin",
        input: schema.dashboardIdInputSchema,
        output: schema.dashboardDefaultOutputSchema,
        execute: (ctx, input) => services.dashboards.setDefault(ctx, input),
        format: json,
      },
    ];
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
    return { ...context, caller: identity.caller };
  }
  /**
   * The permission-filtered catalog a caller sees. Output schemas stay server-side:
   * results still carry `structuredContent`, and shipping them would triple the payload.
   */
  catalog(caller: CallerContext | null): Tool[] {
    return this.definitions
      .filter((definition) =>
        caller?.toolsEnabled === false
          ? false
          : definition.permission === "admin"
            ? caller && hasAdminAuthority(caller)
            : caller?.permissions.sessions?.includes("read"),
      )
      .map((definition) =>
        ToolSchema.parse({
          name: definition.name,
          description: `${definition.instruction ?? governingSentence} ${definition.description}`,
          inputSchema: toolJsonSchema(definition.toolInput ?? definition.input),
          annotations: {
            readOnlyHint:
              definition.readOnly ??
              (definition.permission === "read" ||
                ["audit", "status"].includes(definition.name)),
            destructiveHint: definition.destructive ?? false,
            openWorldHint: false,
          },
        }),
      );
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
    before?: () => Promise<void>,
  ): Promise<CallToolResult> {
    try {
      return await auditedOperation(
        this.services.audit,
        context,
        { action: "mcp.call", detail: { name } },
        async () => {
          await before?.();
          const current = await this.current(context);
          if (current.caller?.toolsEnabled === false)
            throw new ServiceError(
              403,
              "INSTALLATION_TOOLS_DISABLED",
              "MCP tools are disabled for this installation. Capture remains enabled.",
            );
          const definition = this.definitions.find(
            (tool) => tool.name === name,
          );
          if (!definition)
            throw new ServiceError(
              404,
              "UNKNOWN_TOOL",
              "This MCP tool is not available.",
            );
          requirePermission(current, definition.permission);
          const value = await definition.execute(
            current,
            definition.input.parse(input ?? {}),
          );
          const formatted = definition.format(
            definition.output.parse(value.result),
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
