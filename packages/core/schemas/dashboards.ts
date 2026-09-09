import { z } from "zod";
import {
  identityIdSchema,
  jsonValueSchema,
  metricUnitSchema,
  sessionIdSchema,
  utcDateTimeSchema,
} from "./common.js";
import { sqlInputSchema, sqlOutputSchema } from "./sql.js";

/** The shipped read-only dashboards have fixed identities so pickers, defaults and MCP can address them. */
export const builtinDashboardIds = {
  teamOverview: "00000000-0000-4000-8000-000000000001",
  teamActivity: "00000000-0000-4000-8000-000000000002",
} as const;
/** The Team overview is the Home default until an admin picks another dashboard. */
export const builtinDashboardId = builtinDashboardIds.teamOverview;
/** Organizations keep at most this many saved dashboards besides the built-ins. */
export const dashboardSavedLimit = 50;
/** Fixed identity for dashboard definitions that are rendered inline without persistence. */
export const dashboardIdentifierSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9_]{0,39}$/,
    "Use lowercase letters, digits and underscores, starting with a letter.",
  );
const columnNameSchema = z.string().min(1).max(128);
const labelSchema = z.string().trim().min(1).max(40);
export const dashboardNameSchema = z.string().trim().min(1).max(80);
export const dashboardDescriptionSchema = z.string().trim().max(400);

export const dashboardTimePresets = [
  "24h",
  "7d",
  "14d",
  "30d",
  "90d",
  "this_week",
  "last_week",
  "this_month",
  "all",
] as const;
export const dashboardTimePresetSchema = z.enum(dashboardTimePresets);
const variableBase = {
  name: dashboardIdentifierSchema,
  label: labelSchema.optional(),
};
/**
 * Variables become typed ClickHouse query parameters. A time range exposes
 * `{name}_from` and `{name}_to` as DateTime; list variables expose `{name}` as
 * Array(String) where an empty array means "all"; text exposes `{name}` as String.
 */
export const dashboardVariableSchema = z.discriminatedUnion("type", [
  z.strictObject({
    ...variableBase,
    type: z.literal("time_range"),
    default: dashboardTimePresetSchema.default("30d"),
  }),
  z.strictObject({ ...variableBase, type: z.literal("repo") }),
  z.strictObject({ ...variableBase, type: z.literal("harness") }),
  z.strictObject({ ...variableBase, type: z.literal("user") }),
  z.strictObject({
    ...variableBase,
    type: z.literal("text"),
    default: z.string().max(256).default(""),
  }),
]);
export type DashboardVariable = z.infer<typeof dashboardVariableSchema>;
export const dashboardVariableTypes = [
  "time_range",
  "repo",
  "harness",
  "user",
  "text",
] as const;

export const dashboardLayoutSchema = z
  .strictObject({
    x: z.number().int().min(0).max(11),
    y: z.number().int().min(0).max(1000),
    w: z.number().int().min(1).max(12),
    h: z.number().int().min(1).max(40),
  })
  .refine((value) => value.x + value.w <= 12, {
    path: ["w"],
    error: "A tile cannot extend past the 12-column grid.",
  });

/**
 * ECharts styling blocks (itemStyle, label, emphasis, axis options). Bounded to three
 * nesting levels with scalar leaves and no recursive references: JSON cannot carry
 * functions, and tool consumers such as the Gemini API reject recursive schemas.
 */
const styleScalar = z.union([
  z.string().max(256),
  z.number(),
  z.boolean(),
  z.null(),
]);
const styleLeaf = z.union([styleScalar, z.array(styleScalar).max(64)]);
const styleKey = z.string().max(64);
const styleInner = z.record(
  styleKey,
  z.union([styleLeaf, z.record(styleKey, styleLeaf)]),
);
const styleSchema = z.record(styleKey, z.union([styleLeaf, styleInner]));
const sizeSchema = z.union([z.number(), z.string().max(16)]);
export const dashboardSeriesTypes = [
  "line",
  "bar",
  "pie",
  "scatter",
  "gauge",
  "heatmap",
] as const;
/** Allowlisted subset of an ECharts series. Data always comes from the tile query through `encode`. */
const dashboardEncodeSchema = z.strictObject({
  x: columnNameSchema.optional(),
  y: z.union([columnNameSchema, z.array(columnNameSchema).max(20)]).optional(),
  value: columnNameSchema.optional(),
  itemName: columnNameSchema.optional(),
  tooltip: z.array(columnNameSchema).max(20).optional(),
});
export const dashboardSeriesSchema = z.strictObject({
  type: z.enum(dashboardSeriesTypes),
  name: z.string().max(80).optional(),
  encode: dashboardEncodeSchema.optional(),
  stack: z.string().max(40).optional(),
  smooth: z.boolean().optional(),
  step: z.union([z.boolean(), z.enum(["start", "middle", "end"])]).optional(),
  showSymbol: z.boolean().optional(),
  symbol: z.string().max(32).optional(),
  symbolSize: z.number().min(0).max(64).optional(),
  connectNulls: z.boolean().optional(),
  areaStyle: styleSchema.optional(),
  lineStyle: styleSchema.optional(),
  itemStyle: styleSchema.optional(),
  label: styleSchema.optional(),
  labelLine: styleSchema.optional(),
  emphasis: styleSchema.optional(),
  barWidth: sizeSchema.optional(),
  barMaxWidth: sizeSchema.optional(),
  barGap: z.string().max(16).optional(),
  radius: z.union([sizeSchema, z.array(sizeSchema).length(2)]).optional(),
  center: z.array(sizeSchema).length(2).optional(),
  roseType: z.union([z.boolean(), z.enum(["radius", "area"])]).optional(),
  xAxisIndex: z.number().int().min(0).max(3).optional(),
  yAxisIndex: z.number().int().min(0).max(3).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  progress: styleSchema.optional(),
  detail: styleSchema.optional(),
  axisLine: styleSchema.optional(),
  pointer: styleSchema.optional(),
  splitLine: styleSchema.optional(),
  axisLabel: styleSchema.optional(),
  axisTick: styleSchema.optional(),
  title: styleSchema.optional(),
});
const axisSchema = z.union([styleSchema, z.array(styleSchema).max(4)]);
/** Allowlisted ECharts option. Series data, dataset and theme are supplied by the renderer. */
export const dashboardChartSchema = z.strictObject({
  series: z.array(dashboardSeriesSchema).min(1).max(20),
  xAxis: axisSchema.optional(),
  yAxis: axisSchema.optional(),
  legend: styleSchema.optional(),
  tooltip: styleSchema.optional(),
  grid: styleSchema.optional(),
  color: z.array(z.string().max(32)).max(20).optional(),
  dataZoom: z.array(styleSchema).max(2).optional(),
  visualMap: axisSchema.optional(),
  polar: styleSchema.optional(),
  radiusAxis: styleSchema.optional(),
  angleAxis: styleSchema.optional(),
});
export type DashboardChart = z.infer<typeof dashboardChartSchema>;

const tileBase = {
  id: dashboardIdentifierSchema,
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(200).optional(),
  layout: dashboardLayoutSchema,
};
const tileSql = sqlInputSchema.shape.sql;
export const dashboardTileSchema = z.discriminatedUnion("type", [
  z.strictObject({
    ...tileBase,
    type: z.literal("stat"),
    sql: tileSql,
    value: columnNameSchema.optional(),
    compare: columnNameSchema.optional(),
    unit: metricUnitSchema.default("count"),
  }),
  z.strictObject({
    ...tileBase,
    type: z.literal("chart"),
    sql: tileSql,
    series_by: columnNameSchema.optional(),
    unit: metricUnitSchema.optional(),
    chart: dashboardChartSchema,
  }),
  z.strictObject({
    ...tileBase,
    type: z.literal("table"),
    sql: tileSql,
    columns: z.array(columnNameSchema).max(30).optional(),
  }),
  z.strictObject({
    ...tileBase,
    type: z.literal("text"),
    markdown: z.string().max(4000),
  }),
  z.strictObject({
    ...tileBase,
    type: z.literal("control"),
    variable: dashboardIdentifierSchema,
  }),
]);
export type DashboardTile = z.infer<typeof dashboardTileSchema>;
export const dashboardTileTypes = [
  "stat",
  "chart",
  "table",
  "text",
  "control",
] as const;
export const dashboardDefinitionMaxBytes = 64 * 1024;

export const dashboardDefinitionSchema = z
  .strictObject({
    version: z.literal(2),
    variables: z.array(dashboardVariableSchema).max(8).default([]),
    tiles: z.array(dashboardTileSchema).min(1).max(24),
  })
  .superRefine((value, context) => {
    const variables = new Set<string>();
    value.variables.forEach((variable, index) => {
      if (variables.has(variable.name))
        context.addIssue({
          code: "custom",
          path: ["variables", index, "name"],
          message: "Each variable needs a different name.",
        });
      variables.add(variable.name);
    });
    const ids = new Set<string>();
    value.tiles.forEach((tile, index) => {
      if (ids.has(tile.id))
        context.addIssue({
          code: "custom",
          path: ["tiles", index, "id"],
          message: "Each tile needs a different ID.",
        });
      ids.add(tile.id);
      if (tile.type === "control" && !variables.has(tile.variable))
        context.addIssue({
          code: "custom",
          path: ["tiles", index, "variable"],
          message: "A control tile must name a declared variable.",
        });
    });
    if (
      new TextEncoder().encode(JSON.stringify(value)).length >
      dashboardDefinitionMaxBytes
    )
      context.addIssue({
        code: "custom",
        path: ["tiles"],
        message: "Keep the dashboard definition within 64 KB.",
      });
  });
export type DashboardDefinition = z.infer<typeof dashboardDefinitionSchema>;

/** `field` or `field?` for each key of an object shape, in declaration order. */
const fieldList = (shape: Record<string, z.ZodType>, omit: string[] = []) =>
  Object.entries(shape)
    .filter(([key]) => !omit.includes(key))
    .map(([key, field]) =>
      field.safeParse(undefined).success ? `${key}?` : key,
    )
    .join(", ");
/**
 * Tool-facing rendering of a definition for MCP catalogs (§8.2). Variables and tiles are
 * described JSON objects whose text is derived from the strict schema above, so
 * `tools/list` stays under Claude Code's deferral budget instead of inlining the ECharts
 * allowlist once per series. Every handler still validates with
 * `dashboardDefinitionSchema`, which `dashboard_list` serves as `definition_schema`.
 */
export const dashboardDefinitionToolSchema = z
  .strictObject({
    version: z.literal(2),
    variables: z
      .array(
        z
          .looseObject({})
          .describe(
            `Variable {${fieldList(dashboardVariableSchema.options[0].shape, ["type", "default"])}, type, default?}: type time_range (default preset ${dashboardTimePresets.join("|")}) exposes {name}_from and {name}_to as DateTime; repo, harness and user expose {name} as Array(String) where empty means all; text exposes {name} as String.`,
          ),
      )
      .max(8)
      .default([]),
    tiles: z
      .array(
        z
          .looseObject({})
          .describe(
            `Tile {${fieldList(tileBase, ["layout"])}, layout {x 0-11, y, w 1-12, h 1-40}} plus per type: ${dashboardTileSchema.options
              .map(
                (option) =>
                  `${option.shape.type.value} {${fieldList(option.shape, [...Object.keys(tileBase), "type"])}}`,
              )
              .join(
                "; ",
              )}. sql: one ClickHouse SELECT over api_ro, declared variables as {name:Type}. unit: ${metricUnitSchema.options.join("|")}. chart: allowlisted ECharts option with series (1-20; type ${dashboardSeriesTypes.join("|")}; encode {${fieldList(dashboardEncodeSchema.shape)}} binds result columns; ${fieldList(dashboardSeriesSchema.shape, ["type", "encode"])}) and ${fieldList(dashboardChartSchema.shape, ["series"])}. Style blocks: plain JSON, at most three levels, scalar or scalar-array leaves. Unknown keys are rejected.`,
          ),
      )
      .min(1)
      .max(24),
  })
  .describe(
    "Dashboard definition. dashboard_list returns its complete JSON Schema as definition_schema with starter templates; dashboard_render validates an inline definition and names the failing path.",
  );

const saveInputShape = {
  id: sessionIdSchema.optional(),
  revision: z.number().int().nonnegative().optional(),
  name: dashboardNameSchema,
  description: dashboardDescriptionSchema.default(""),
};
const saveInputCheck = (
  value: { id?: string | undefined; revision?: number | undefined },
  context: z.RefinementCtx,
) => {
  if ((value.id === undefined) !== (value.revision === undefined))
    context.addIssue({
      code: "custom",
      path: ["revision"],
      message: "Include the saved revision when updating a dashboard.",
    });
};
export const dashboardSaveInputSchema = z
  .strictObject({ ...saveInputShape, definition: dashboardDefinitionSchema })
  .superRefine(saveInputCheck);
/** MCP catalog rendering of `dashboardSaveInputSchema`; handlers parse the strict schema. */
export const dashboardSaveToolInputSchema = z
  .strictObject({
    ...saveInputShape,
    definition: dashboardDefinitionToolSchema,
  })
  .superRefine(saveInputCheck);
export const dashboardIdInputSchema = z.strictObject({ id: sessionIdSchema });
const dashboardAuthorSchema = z
  .strictObject({
    user_id: identityIdSchema,
    email: z.string().nullable(),
    name: z.string().nullable(),
  })
  .nullable();
export const dashboardSummarySchema = z.strictObject({
  id: sessionIdSchema,
  organization_id: identityIdSchema,
  name: dashboardNameSchema,
  description: z.string(),
  revision: z.number().int().nonnegative(),
  builtin: z.boolean(),
  is_default: z.boolean(),
  can_edit: z.boolean(),
  created_by: dashboardAuthorSchema,
  tile_count: z.number().int().nonnegative(),
  created_at: utcDateTimeSchema,
  updated_at: utcDateTimeSchema,
});
export const dashboardSchema = dashboardSummarySchema.extend({
  definition: dashboardDefinitionSchema,
});
export const dashboardTileTemplateSchema = z.strictObject({
  id: dashboardIdentifierSchema,
  title: z.string(),
  description: z.string(),
  variables: z.array(dashboardVariableSchema).default([]),
  tile: dashboardTileSchema,
});
export type DashboardTileTemplate = z.infer<typeof dashboardTileTemplateSchema>;
export const dashboardListOutputSchema = z.strictObject({
  items: z
    .array(dashboardSummarySchema)
    .max(dashboardSavedLimit + Object.keys(builtinDashboardIds).length),
  default_id: sessionIdSchema,
  definition_schema: jsonValueSchema,
  templates: z.array(dashboardTileTemplateSchema),
});
export const dashboardDeleteOutputSchema = z.strictObject({
  deleted: z.boolean(),
});
export const dashboardDefaultOutputSchema = z.strictObject({
  default_id: sessionIdSchema,
});

const timeRangeValueSchema = z.union([
  dashboardTimePresetSchema,
  z.strictObject({ from: utcDateTimeSchema, to: utcDateTimeSchema }),
]);
export const dashboardVariableValueSchema = z.union([
  timeRangeValueSchema,
  z.array(z.string().min(1).max(256)).max(50),
  z.string().max(256),
]);
export const dashboardVariablesInputSchema = z.record(
  dashboardIdentifierSchema,
  dashboardVariableValueSchema,
);
const renderInputShape = {
  tiles: z.array(dashboardIdentifierSchema).min(1).max(24).optional(),
  /** Re-run the tiles instead of serving the hour-old cached result. */
  refresh: z.boolean().default(false),
};
const renderInputCheck = (value: {
  id?: string | undefined;
  definition?: unknown;
}) => (value.id === undefined) !== (value.definition === undefined);
const renderInputError = {
  path: ["id"],
  error: "Render either a saved dashboard by id or an inline definition.",
};
export const dashboardRenderInputSchema = z
  .strictObject({
    id: sessionIdSchema.optional(),
    definition: dashboardDefinitionSchema.optional(),
    variables: dashboardVariablesInputSchema.default({}),
    ...renderInputShape,
  })
  .refine(renderInputCheck, renderInputError);
/** MCP catalog rendering of `dashboardRenderInputSchema`; handlers parse the strict schema. */
export const dashboardRenderToolInputSchema = z
  .strictObject({
    id: sessionIdSchema.optional(),
    definition: dashboardDefinitionToolSchema.optional(),
    variables: z
      .looseObject({})
      .default({})
      .describe(
        `Values by variable name: a preset (${dashboardTimePresets.join("|")}) or {from, to} in UTC for time_range; a list of strings for repo, harness and user; text for text.`,
      ),
    ...renderInputShape,
  })
  .refine(renderInputCheck, renderInputError);
export const dashboardResolvedVariableSchema = z.union([
  z.strictObject({ from: utcDateTimeSchema, to: utcDateTimeSchema }),
  z.array(z.string()),
  z.string(),
]);
export const dashboardTileResultSchema = z.strictObject({
  id: dashboardIdentifierSchema,
  result: sqlOutputSchema.nullable(),
  error: z.strictObject({ code: z.string(), message: z.string() }).nullable(),
});
export const dashboardRenderOutputSchema = z.strictObject({
  tiles: z.array(dashboardTileResultSchema),
  variables: z.record(
    dashboardIdentifierSchema,
    dashboardResolvedVariableSchema,
  ),
  rendered_at: utcDateTimeSchema,
  /** True when the result came from the render cache; `rendered_at` is then the original run. */
  cached: z.boolean(),
});
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;
export type Dashboard = z.infer<typeof dashboardSchema>;
export type DashboardRenderInput = z.infer<typeof dashboardRenderInputSchema>;
export type DashboardRenderOutput = z.infer<typeof dashboardRenderOutputSchema>;
export type DashboardTileResult = z.infer<typeof dashboardTileResultSchema>;
export type DashboardVariableValue = z.infer<
  typeof dashboardVariableValueSchema
>;
export type DashboardResolvedVariable = z.infer<
  typeof dashboardResolvedVariableSchema
>;
