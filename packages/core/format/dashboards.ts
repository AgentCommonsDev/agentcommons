import type { z } from "zod";
import type {
  Dashboard,
  DashboardRenderOutput,
  DashboardTile,
  DashboardVariable,
  dashboardListOutputSchema,
  dashboardResolvedVariableSchema,
} from "../schemas/dashboards.js";
import { jsonByteLength } from "../schemas/common.js";
import { formatSql, type Formatted } from "./index.js";

/**
 * Text renderings of the dashboard tool results (§10). The text is what an agent reads,
 * so it carries identities, counts and SQL once each and leaves chart options, layouts
 * and the definition JSON Schema to `structuredContent`, which stays the full validated
 * result. `dashboard_list` once shipped the schema and every template pretty-printed:
 * 257 KB for two dashboards.
 */
export type DashboardListOutput = z.infer<typeof dashboardListOutputSchema>;
type ResolvedVariable = z.infer<typeof dashboardResolvedVariableSchema>;

const plural = (count: number, noun: string) =>
  `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
/** One line, cells separated by ` | ` with pipes in cells escaped the way `sql` prints them. */
const row = (cells: readonly string[]) =>
  cells
    .map((cell) =>
      cell
        .replaceAll("\r", "\\r")
        .replaceAll("\n", "\\n")
        .replaceAll("|", "\\|"),
    )
    .join(" | ");
const flags = (item: DashboardListOutput["items"][number]) =>
  [
    ...(item.is_default ? ["default"] : []),
    ...(item.builtin ? ["built-in"] : []),
    ...(item.can_edit ? ["editable"] : []),
  ].join(",") || "-";

export function formatDashboardList(
  result: DashboardListOutput,
): Formatted<DashboardListOutput> {
  const schemaBytes = jsonByteLength(result.definition_schema);
  const text = [
    `${plural(result.items.length, "dashboard")} | default_id: ${result.default_id}`,
    row(["id", "name", "tiles", "flags", "updated_at", "description"]),
    ...result.items.map((item) =>
      row([
        item.id,
        item.name,
        String(item.tile_count),
        flags(item),
        item.updated_at,
        item.description,
      ]),
    ),
    "",
    `${plural(result.templates.length, "tile template")} for dashboard_save (id: title): ${result.templates
      .map((template) => `${template.id}: ${template.title}`)
      .join("; ")}`,
    `Next: dashboard_get(id) shows a dashboard's variables, tiles and SQL (a built-in is a complete working definition to copy); dashboard_render(id) runs it. The definition JSON Schema (${String(schemaBytes)} bytes) is structuredContent.definition_schema; the dashboard_save input schema summarises it.`,
  ].join("\n");
  return { text, structuredContent: result };
}

function variableRow(variable: DashboardVariable): string {
  return row([
    variable.name,
    variable.type,
    variable.label ?? "-",
    "default" in variable ? variable.default : "-",
  ]);
}
function tileDetails(tile: DashboardTile): string {
  switch (tile.type) {
    case "stat":
      return `value=${tile.value ?? "first column"}${tile.compare ? ` compare=${tile.compare}` : ""} unit=${tile.unit}`;
    case "chart":
      return `series=${tile.chart.series.map((series) => series.type).join(",")}${tile.series_by ? ` series_by=${tile.series_by}` : ""}${tile.unit ? ` unit=${tile.unit}` : ""}`;
    case "table":
      return tile.columns ? `columns=${tile.columns.join(",")}` : "all columns";
    case "text":
      return `markdown ${plural(tile.markdown.length, "char")}: ${tile.markdown.split("\n")[0] ?? ""}`;
    case "control":
      return `variable=${tile.variable}`;
  }
}
export function formatDashboard(result: Dashboard): Formatted<Dashboard> {
  const { definition } = result;
  const text = [
    `id: ${result.id} | name: ${row([result.name])} | revision: ${String(result.revision)}`,
    `description: ${row([result.description]) || "-"}`,
    `builtin: ${String(result.builtin)} | is_default: ${String(result.is_default)} | can_edit: ${String(result.can_edit)}`,
    `created_by: ${result.created_by?.email ?? "null"} | created_at: ${result.created_at} | updated_at: ${result.updated_at}`,
    "",
    definition.variables.length
      ? [
          `${plural(definition.variables.length, "variable")} (reference as {name:Type}; time_range exposes {name}_from and {name}_to):`,
          row(["name", "type", "label", "default"]),
          ...definition.variables.map(variableRow),
        ].join("\n")
      : "no variables",
    "",
    `${plural(definition.tiles.length, "tile")}:`,
    row(["id", "type", "title", "layout", "details"]),
    ...definition.tiles.map((tile) =>
      row([
        tile.id,
        tile.type,
        tile.title,
        `x${String(tile.layout.x)} y${String(tile.layout.y)} w${String(tile.layout.w)} h${String(tile.layout.h)}`,
        tileDetails(tile),
      ]),
    ),
    ...definition.tiles.flatMap((tile) =>
      "sql" in tile ? ["", `sql ${tile.id}:`, tile.sql] : [],
    ),
    "",
    "Chart options and the complete definition are structuredContent.definition; dashboard_render(id) runs the tiles.",
  ].join("\n");
  return { text, structuredContent: result };
}

/** "13 minutes", "2 hours", "3 days": the distance between two instants, coarsely. */
export function ageInWords(from: string, now: Date): string {
  const seconds = Math.max(
    0,
    (now.getTime() - new Date(from).getTime()) / 1000,
  );
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${plural(Math.max(1, minutes), "minute")} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${plural(hours, "hour")} ago`;
  return `${plural(Math.round(hours / 24), "day")} ago`;
}
function resolvedVariable(value: ResolvedVariable): string {
  if (typeof value === "string") return value || "(empty)";
  if (Array.isArray(value)) return value.length ? value.join(",") : "all";
  return `${value.from}..${value.to}`;
}
export function formatDashboardRender(
  result: DashboardRenderOutput,
  now: Date = new Date(),
): Formatted<DashboardRenderOutput> {
  const age = ageInWords(result.rendered_at, now);
  const status = result.cached
    ? `cached: true (served from the render cache, rendered ${age}; pass refresh: true to re-run the tiles)`
    : `cached: false (rendered ${age})`;
  const variables = Object.entries(result.variables).map(
    ([name, value]) => `${name}: ${resolvedVariable(value)}`,
  );
  const text = [
    `${plural(result.tiles.length, "tile")} | rendered_at: ${result.rendered_at} | ${status}`,
    `variables: ${variables.length ? variables.join(" | ") : "none"}`,
    ...result.tiles.flatMap((tile) => [
      "",
      tile.error
        ? `tile ${tile.id}: error ${tile.error.code}: ${tile.error.message}`
        : `tile ${tile.id}: ${tile.result ? formatSql(tile.result).text : "no result"}`,
    ]),
  ].join("\n");
  return { text, structuredContent: result };
}
