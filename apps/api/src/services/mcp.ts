import { z } from "zod";
import {
  ToolSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
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

const governingSentence =
  "Only use this when the user asks about previous sessions or prior work; where possible run multi-step investigation in a subagent that returns only findings with session ids.";
interface Definition {
  name: string;
  description: string;
  permission: "read" | "admin";
  input: z.ZodType;
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
export class McpService {
  private readonly definitions: Definition[];
  constructor(private readonly services: Services) {
    this.definitions = [
      {
        name: "dashboard_list",
        instruction:
          "Use this when the user asks to view or manage their dashboard profiles.",
        readOnly: true,
        description:
          "List your personal dashboard profiles in the current organization and the versioned declaration schema.",
        permission: "read",
        input: z.strictObject({}),
        output: schema.dashboardListOutputSchema,
        execute: (ctx) => services.dashboards.list(ctx),
        format: json,
      },
      {
        name: "dashboard_save",
        instruction:
          "Use this when the user asks to view or manage their dashboard profiles.",
        readOnly: false,
        description:
          "Create or update your personal dashboard with number, line, bar or table widgets over guarded SELECT queries. Use id and revision to update an existing profile.",
        permission: "read",
        input: schema.dashboardSaveInputSchema,
        output: schema.dashboardProfileSchema,
        execute: (ctx, input) => services.dashboards.save(ctx, input),
        format: json,
      },
      {
        name: "dashboard_delete",
        instruction:
          "Use this when the user asks to view or manage their dashboard profiles.",
        readOnly: false,
        description:
          "Delete one of your personal dashboards in the current organization.",
        permission: "read",
        input: schema.dashboardIdInputSchema,
        output: schema.dashboardDeleteOutputSchema,
        destructive: true,
        execute: (ctx, input) => services.dashboards.delete(ctx, input),
        format: json,
      },
      {
        name: "search",
        description:
          "Search previous coding-agent messages with words and structured filters. All query tokens must match; English inflections share a stem. Results contain message windows grouped by session; use session_id and seq with get or sql.",
        permission: "read",
        input: schema.searchInputSchema,
        output: schema.searchOutputSchema,
        execute: (ctx, input) => services.search.execute(ctx, input),
        format: (value) => formatSearch(schema.searchOutputSchema.parse(value)),
      },
      {
        name: "get",
        description:
          "Read a session header and messages by session_id. Bound a range with from/to; use next and content_cursor to continue.",
        permission: "read",
        input: schema.getInputSchema,
        output: schema.getOutputSchema,
        execute: (ctx, input) => services.sessions.get(ctx, input),
        format: (value) => formatGet(schema.getOutputSchema.parse(value)),
      },
      {
        name: "sql",
        description:
          "Run one read-only ClickHouse SELECT over api_ro. Views: sessions (session metadata); messages (normalized messages); session_files (observed files); session_observed_commits (commit observations); session_tools (tool counts); users (visible contributors); installations (visible devices); repos (visible repository counts); schema_columns (column descriptions); schema_functions (function descriptions). search_messages(q='words') returns uncapped session_id,seq,rank. Discover columns with SELECT * FROM schema_columns WHERE view_name = 'sessions'. Limits: 500 rows, 5 seconds.",
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
  list(context: ServiceContext) {
    return auditedOperation(
      this.services.audit,
      context,
      { action: "mcp.tools.list" },
      async () => {
        const current = await this.current(context);
        const tools = this.definitions
          .filter((definition) =>
            current.caller?.toolsEnabled === false
              ? false
              : definition.permission === "admin"
                ? current.caller && hasAdminAuthority(current.caller)
                : current.caller?.permissions.sessions?.includes("read"),
          )
          .map((definition) =>
            ToolSchema.parse({
              name: definition.name,
              description: `${definition.instruction ?? governingSentence} ${definition.description}`,
              inputSchema: z.toJSONSchema(definition.input, { io: "input" }),
              outputSchema: z.toJSONSchema(definition.output, { io: "output" }),
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
