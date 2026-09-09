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
  type Formatted,
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
  "Use this to check prior work before changing code, and whenever the user asks about earlier sessions; run long investigations in a subagent that returns only findings with session ids.";
/**
 * Server `instructions` returned by `initialize` (§8.2). Claude Code places them in its
 * system prompt, so this is where an agent learns to look before it edits.
 */
export const serverInstructions =
  "AgentCommons indexes this organization's past coding-agent sessions (search, get, sql). Before changing code, search for the test, file path or error you were given: an earlier session often holds the root cause, the library the team chose or the exact value; read a hit with get and cite its session_id. Also use it whenever the user asks about prior work. Keep long investigations in a subagent that returns only findings and session ids.";
/** Catalog order of `tools/list` for a read key; the constructor checks the registry agrees. */
export const readToolNames = [
  "dashboard_list",
  "dashboard_get",
  "dashboard_render",
  "dashboard_save",
  "dashboard_delete",
  "search",
  "get",
  "sql",
] as const;
/** The tools an effective admin key sees after the read tools, in catalog order. */
export const adminToolNames = [
  "set_visibility",
  "purge",
  "audit",
  "status",
  "dashboard_set_default",
] as const;
interface Definition<
  I extends z.ZodType = z.ZodType,
  O extends z.ZodType = z.ZodType,
> {
  name: string;
  description: string;
  permission: "read" | "admin";
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
  format(value: z.output<O>): Formatted<z.output<O>>;
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
        name: "dashboard_list",
        instruction: dashboardInstruction,
        readOnly: true,
        destructive: false,
        description:
          "List the organization's dashboards, which one is the Home default, the JSON Schema for definitions and starter tile templates. Two built-ins always exist: Team overview (captured sessions, search adoption and reuse; the default until an admin picks another) and Team activity (sessions, messages, tool calls, repositories and coding tools per person, for managers).",
        permission: "read",
        input: schema.emptySchema,
        output: schema.dashboardListOutputSchema,
        execute: (ctx) => services.dashboards.list(ctx),
        format: formatJson,
      }),
      define({
        name: "dashboard_get",
        instruction: dashboardInstruction,
        readOnly: true,
        destructive: false,
        description:
          "Read one dashboard by id with its full definition: variables, tiles, SQL, layout and chart options.",
        permission: "read",
        input: schema.dashboardIdInputSchema,
        output: schema.dashboardSchema,
        execute: (ctx, input) => services.dashboards.get(ctx, input),
        format: formatJson,
      }),
      define({
        name: "dashboard_render",
        instruction: dashboardInstruction,
        readOnly: true,
        destructive: false,
        description:
          'Run the queries of a dashboard (by id or an inline definition) with variable values such as {"time_range":"7d","repo":["github.com/org/repo"]} and return each tile\'s rows. Pass tiles to render a subset.',
        permission: "read",
        input: schema.dashboardRenderInputSchema,
        toolInput: schema.dashboardRenderToolInputSchema,
        output: schema.dashboardRenderOutputSchema,
        execute: (ctx, input) => services.dashboards.render(ctx, input),
        format: formatJson,
      }),
      define({
        name: "dashboard_save",
        instruction: dashboardInstruction,
        readOnly: false,
        destructive: false,
        description:
          "Create or update a dashboard everyone in the organization can see. Start from dashboard_list templates, validate with dashboard_render on an inline definition, then save. Updates need id and revision; only the creator or an organization admin can change a saved dashboard.",
        permission: "read",
        input: schema.dashboardSaveInputSchema,
        toolInput: schema.dashboardSaveToolInputSchema,
        output: schema.dashboardSchema,
        execute: (ctx, input) => services.dashboards.save(ctx, input),
        format: formatJson,
      }),
      define({
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
        format: formatJson,
      }),
      define({
        name: "search",
        description:
          'Search previous coding-agent sessions with words and structured filters. Start with the test name, file path or error you were given: an earlier session often holds the root cause, the library the team chose or the exact value. All query tokens must match; English inflections share a stem. Results are message windows grouped by session; follow up with get (session_id, seq) or sql. Each filter takes one value or a list (any of), all filters must hold, and the input schema states what each one means. Example, sessions that edited a file under src/auth/: {"query":"","filters":{"file_prefix":"src/auth/","file_operation":"edit"}}.',
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
        description:
          'Read one session by session_id: a header (who ran it, harness, model, repository, branch, start, end, status, message, tool call, token, file, commit and reuse counts, tools_used, root_session_id, parent and child sessions) and its messages in seq order with role, kind, tool_name, tool_use_id and content. Each child ref carries parent_tool_use_id, the tool_use_id of the TOOL_USE message here that spawned it (null when unrecorded), so a subagent run reads in place under its call. Bound a range with from/to; when next is not null, pass it as cursor. Example: {"session_id":"<uuid>","from":0,"to":40}.',
        permission: "read",
        readOnly: true,
        destructive: false,
        input: schema.getInputSchema,
        output: schema.getOutputSchema,
        execute: (ctx, input) => services.sessions.get(ctx, input),
        format: formatGet,
      }),
      define({
        name: "sql",
        description:
          "Run one read-only ClickHouse SELECT over api_ro. Views: sessions (session metadata); messages (normalized messages); session_files (observed files); session_observed_commits (commit observations); session_tools (tool counts); users (visible contributors); installations (visible devices); repos (visible repository counts); schema_columns (column descriptions); schema_functions (function descriptions). search_messages(q='words') returns uncapped session_id,seq,rank. Discover columns with SELECT * FROM schema_columns WHERE view_name = 'sessions' and every table function this organization can use with SELECT * FROM schema_functions. Limits: 500 rows, 5 seconds.",
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
    const listed = (permission: Definition["permission"]) =>
      definitions
        .filter((definition) => definition.permission === permission)
        .map((definition) => definition.name)
        .join();
    if (
      listed("read") !== readToolNames.join() ||
      listed("admin") !== adminToolNames.join()
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
  /**
   * The permission-filtered catalog a caller sees. Output schemas stay server-side:
   * results still carry `structuredContent`, and shipping them would triple the payload.
   */
  catalog(caller: CallerContext | null): Tool[] {
    return this.tools
      .filter(({ definition }) =>
        caller?.toolsEnabled === false
          ? false
          : definition.permission === "admin"
            ? caller && hasAdminAuthority(caller)
            : caller?.permissions.sessions?.includes("read"),
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
