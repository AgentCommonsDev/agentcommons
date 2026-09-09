import type { EChartsCoreOption } from "echarts/core";
import type { LayoutItem } from "react-grid-layout";
import type { JsonValue, MetricUnit } from "@agentcommons/core/schemas/common";
import {
  dashboardTimePresets,
  type DashboardChart,
  type DashboardDefinition,
  type DashboardTile,
  type DashboardTileResult,
  type DashboardTileTemplate,
  type DashboardVariable,
  type DashboardVariableValue,
} from "@agentcommons/core/schemas/dashboards";
import {
  dashboardScopeSql,
  standardDashboardVariables,
} from "@agentcommons/core/dashboards";
import { copy } from "../../copy";
import { columnValueLabel, fieldLabel, metricValue } from "../../lib/display";

export type SqlResult = NonNullable<DashboardTileResult["result"]>;
export type TileResult = DashboardTileResult;
export type VariableValues = Record<string, DashboardVariableValue>;
export type TimePreset = (typeof dashboardTimePresets)[number];
type TimeRangeValue = TimePreset | { from: string; to: string };
export type TileOf<T extends DashboardTile["type"]> = Extract<
  DashboardTile,
  { type: T }
>;
type SqlTile = TileOf<"stat" | "chart" | "table">;
export type ChartKind = keyof typeof copy.dashboards.inspector.kinds;

export const gridBreakpoints = { lg: 1024, md: 640, xs: 0 } as const;
export const gridColumns = { lg: 12, md: 8, xs: 1 } as const;
export const gridRowHeight = 56;
export const gridMargin: readonly [number, number] = [16, 16];
export type GridBreakpoint = keyof typeof gridBreakpoints;

export const hasSql = (tile: DashboardTile): tile is SqlTile => "sql" in tile;
const isPreset = (value: unknown): value is TimePreset =>
  typeof value === "string" &&
  (dashboardTimePresets as readonly string[]).includes(value);
const isoDate = (value: string) => !Number.isNaN(Date.parse(value));

/* ---------- Variables ---------- */
export function defaultVariableValue(
  variable: DashboardVariable,
): DashboardVariableValue {
  if (variable.type === "time_range" || variable.type === "text")
    return variable.default;
  return [];
}
/** Variable values live in the URL so dashboard links are shareable. */
export function variablesFromSearch(
  variables: readonly DashboardVariable[],
  search: URLSearchParams,
): VariableValues {
  const values: VariableValues = {};
  for (const variable of variables) {
    const { name } = variable;
    if (variable.type === "time_range") {
      const preset = search.get(name);
      const from = search.get(`${name}_from`);
      const to = search.get(`${name}_to`);
      values[name] =
        from && to && isoDate(from) && isoDate(to)
          ? { from, to }
          : isPreset(preset)
            ? preset
            : variable.default;
    } else if (variable.type === "text") {
      values[name] = (search.get(name) ?? variable.default).slice(0, 256);
    } else {
      values[name] = search
        .getAll(name)
        .filter((item) => item.length > 0 && item.length <= 256)
        .slice(0, 50);
    }
  }
  return values;
}
export function searchFromVariables(
  variables: readonly DashboardVariable[],
  values: VariableValues,
  base: URLSearchParams,
): URLSearchParams {
  const next = new URLSearchParams(base);
  for (const variable of variables) {
    const { name } = variable;
    next.delete(name);
    next.delete(`${name}_from`);
    next.delete(`${name}_to`);
    const value = values[name];
    if (value === undefined) continue;
    if (variable.type === "time_range") {
      if (typeof value === "object" && !Array.isArray(value)) {
        next.set(`${name}_from`, value.from);
        next.set(`${name}_to`, value.to);
      } else if (isPreset(value) && value !== variable.default)
        next.set(name, value);
    } else if (variable.type === "text") {
      if (typeof value === "string" && value !== variable.default)
        next.set(name, value);
    } else if (Array.isArray(value))
      for (const item of value) next.append(name, item);
  }
  return next;
}
export function variableLabel(variable: DashboardVariable): string {
  return variable.label ?? copy.dashboards.variables.types[variable.type];
}
export function timeRangeValue(
  value: DashboardVariableValue | undefined,
  fallback: TimePreset,
): TimeRangeValue {
  if (typeof value === "object" && !Array.isArray(value)) return value;
  return isPreset(value) ? value : fallback;
}
export function listValue(value: DashboardVariableValue | undefined): string[] {
  return Array.isArray(value) ? value : [];
}
export function textValueOf(
  value: DashboardVariableValue | undefined,
  fallback: string,
): string {
  return typeof value === "string" ? value : fallback;
}

/* ---------- Result cells ---------- */
type ColumnKind = "number" | "datetime" | "date" | "text";
export function columnKind(type: string): ColumnKind {
  const inner = type.replace(/^(Nullable|LowCardinality)\((.*)\)$/, "$2");
  if (/^(U?Int\d+|Float\d+|Decimal)/.test(inner)) return "number";
  if (inner.startsWith("DateTime")) return "datetime";
  if (inner === "Date" || inner === "Date32") return "date";
  return "text";
}
export function cellNumber(value: JsonValue | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
function columnIndex(result: SqlResult, name: string | undefined): number {
  return name === undefined
    ? -1
    : result.columns.findIndex((column) => column.name === name);
}
function firstNumericColumn(result: SqlResult): number {
  const first = result.rows[0];
  return result.columns.findIndex(
    (column, index) =>
      columnKind(column.type) === "number" ||
      cellNumber(first?.[index]) !== null,
  );
}
export function statValues(
  tile: TileOf<"stat">,
  result: SqlResult,
): { value: number | null; compare: number | null } {
  const row = result.rows[0];
  const valueIndex =
    tile.value === undefined
      ? firstNumericColumn(result)
      : columnIndex(result, tile.value);
  const compareIndex = columnIndex(result, tile.compare);
  return {
    value: valueIndex < 0 ? null : cellNumber(row?.[valueIndex]),
    compare: compareIndex < 0 ? null : cellNumber(row?.[compareIndex]),
  };
}

/* ---------- Charts ---------- */
function axisType(axis: DashboardChart["xAxis"]): unknown {
  return Array.isArray(axis) ? axis[0]?.type : axis?.type;
}
export function chartKind(chart: DashboardChart): ChartKind {
  const first = chart.series[0];
  switch (first?.type) {
    case "pie":
      return "pie";
    case "scatter":
      return "scatter";
    case "bar":
      if (
        axisType(chart.xAxis) === "value" &&
        axisType(chart.yAxis) === "category"
      )
        return "horizontal_bar";
      return first.stack ? "stacked_bar" : "bar";
    default:
      return first?.areaStyle ? "area" : "line";
  }
}
interface ChartBindings {
  x: string | undefined;
  ys: string[];
  legend: boolean;
  smooth: boolean;
}
const yColumns = (y: string | string[] | undefined) =>
  y === undefined ? [] : Array.isArray(y) ? y : [y];
export function chartBindings(chart: DashboardChart): ChartBindings {
  const kind = chartKind(chart);
  const first = chart.series[0];
  const legend = chart.legend !== undefined;
  const smooth = Boolean(first?.smooth);
  if (kind === "pie")
    return {
      x: first?.encode?.itemName,
      ys: yColumns(first?.encode?.value),
      legend,
      smooth,
    };
  if (kind === "horizontal_bar")
    return {
      x:
        first?.encode?.y === undefined
          ? undefined
          : yColumns(first.encode.y)[0],
      ys: chart.series.flatMap((series) => yColumns(series.encode?.x)),
      legend,
      smooth,
    };
  return {
    x: first?.encode?.x,
    ys: chart.series.flatMap((series) => yColumns(series.encode?.y)),
    legend,
    smooth,
  };
}
/** Build the allowlisted chart JSON from the inspector's choices. */
export function buildChart(
  kind: ChartKind,
  bindings: ChartBindings,
): DashboardChart {
  const { x, ys, legend, smooth } = bindings;
  const named = (y: string) => ({ name: fieldLabel(y) });
  const legendBlock = legend ? { legend: {} } : {};
  if (kind === "pie") {
    const value = ys[0];
    return {
      series: [
        {
          type: "pie",
          radius: ["45%", "72%"],
          encode: {
            ...(x === undefined ? {} : { itemName: x }),
            ...(value === undefined ? {} : { value }),
          },
        },
      ],
      ...legendBlock,
    };
  }
  if (kind === "horizontal_bar")
    return {
      series: (ys.length ? ys : [undefined]).map((y) => ({
        type: "bar",
        ...(y === undefined ? {} : named(y)),
        encode: {
          ...(y === undefined ? {} : { x: y }),
          ...(x === undefined ? {} : { y: x }),
        },
      })),
      xAxis: { type: "value" },
      yAxis: { type: "category", inverse: true },
      ...legendBlock,
    };
  const encode = (y: string | undefined) => ({
    ...(x === undefined ? {} : { x }),
    ...(y === undefined ? {} : { y }),
  });
  const list = ys.length ? ys : [undefined];
  const series: DashboardChart["series"] = list.map((y) => {
    const base = { ...(y === undefined ? {} : named(y)), encode: encode(y) };
    switch (kind) {
      case "scatter":
        return { type: "scatter", ...base };
      case "bar":
        return { type: "bar", ...base };
      case "stacked_bar":
        return { type: "bar", stack: "total", ...base };
      case "area":
        return { type: "line", smooth, areaStyle: {}, ...base };
      default:
        return { type: "line", smooth, ...base };
    }
  });
  return {
    series,
    xAxis: { type: kind === "scatter" ? "value" : "category" },
    yAxis: { type: "value" },
    ...legendBlock,
  };
}
interface Dataset {
  dimensions: { name: string; type: "number" | "ordinal" }[];
  source: (string | number | null)[][];
}
function chartDataset(result: SqlResult): Dataset {
  const kinds = result.columns.map((column) => columnKind(column.type));
  return {
    dimensions: result.columns.map((column, index) => ({
      name: column.name,
      type: kinds[index] === "number" ? "number" : "ordinal",
    })),
    source: result.rows.map((row) =>
      row.map((cell, index) => {
        if (kinds[index] === "number") return cellNumber(cell);
        if (cell === null) return null;
        if (typeof cell === "string")
          return columnValueLabel(result.columns[index]?.name ?? "", cell);
        return typeof cell === "number" ? cell : JSON.stringify(cell);
      }),
    ),
  };
}
/** Pivot long rows (x, series_by, y) into one series per distinct series_by value. */
function pivotDataset(
  dataset: Dataset,
  result: SqlResult,
  by: string,
  x: string,
  y: string,
): Dataset {
  const byIndex = columnIndex(result, by);
  const xIndex = columnIndex(result, x);
  const yIndex = columnIndex(result, y);
  if (byIndex < 0 || xIndex < 0 || yIndex < 0) return dataset;
  const names: string[] = [];
  const rows = new Map<string, Map<string, number | null>>();
  for (const row of dataset.source) {
    const key = String(row[xIndex] ?? "");
    const name = String(row[byIndex] ?? "");
    if (!names.includes(name)) {
      if (names.length >= 20) continue;
      names.push(name);
    }
    const entry = rows.get(key) ?? new Map<string, number | null>();
    const value = row[yIndex];
    entry.set(name, typeof value === "number" ? value : null);
    rows.set(key, entry);
  }
  return {
    dimensions: [
      { name: x, type: dataset.dimensions[xIndex]?.type ?? "ordinal" },
      ...names.map((name) => ({ name, type: "number" as const })),
    ],
    source: [...rows.entries()].map(([key, entry]) => [
      key,
      ...names.map((name) => entry.get(name) ?? null),
    ]),
  };
}
type Formatter = (value: unknown) => string;
function unitFormatter(unit: MetricUnit): Formatter {
  return (value) =>
    typeof value === "number" || typeof value === "string"
      ? metricValue(value, unit, { compact: true })
      : "";
}
function withAxisFormatter(
  axis: DashboardChart["xAxis"],
  fallbackValue: boolean,
  formatter: Formatter,
): unknown {
  const decorate = (entry: Record<string, unknown>) =>
    entry.type === "value" || (entry.type === undefined && fallbackValue)
      ? {
          ...entry,
          axisLabel: { ...(entry.axisLabel as object | undefined), formatter },
        }
      : entry;
  if (axis === undefined) return fallbackValue ? decorate({}) : undefined;
  return Array.isArray(axis) ? axis.map(decorate) : decorate(axis);
}
/** Turn a tile's allowlisted chart JSON and its query result into a full ECharts option. */
export function chartOption(
  tile: TileOf<"chart">,
  result: SqlResult,
): EChartsCoreOption | null {
  const first = tile.chart.series[0];
  if (!first) return null;
  let dataset = chartDataset(result);
  let series: DashboardChart["series"] = tile.chart.series;
  const x = first.encode?.x;
  const y = yColumns(first.encode?.y)[0];
  if (tile.series_by !== undefined && x !== undefined && y !== undefined) {
    dataset = pivotDataset(dataset, result, tile.series_by, x, y);
    series = dataset.dimensions.slice(1).map((dimension) => ({
      ...first,
      name: dimension.name,
      encode: { ...first.encode, x, y: dimension.name },
    }));
  }
  const kind = chartKind(tile.chart);
  const named = series.map((entry) => {
    // A legend already names pie slices; slice labels would repeat it and overlap the ring.
    const quiet =
      entry.type === "pie" &&
      entry.label === undefined &&
      tile.chart.legend !== undefined
        ? { ...entry, label: { show: false }, labelLine: { show: false } }
        : entry;
    if (quiet.name !== undefined) return quiet;
    const column =
      kind === "horizontal_bar"
        ? yColumns(quiet.encode?.x)[0]
        : yColumns(quiet.encode?.y)[0];
    return column === undefined
      ? quiet
      : { ...quiet, name: fieldLabel(column) };
  });
  const unit = tile.unit;
  const formatter = unit === undefined ? undefined : unitFormatter(unit);
  const legend =
    tile.chart.legend === undefined
      ? {}
      : { legend: { top: 0, type: "scroll", ...tile.chart.legend } };
  const cartesian = kind !== "pie";
  const option: Record<string, unknown> = {
    ...tile.chart,
    ...legend,
    dataset,
    series: named,
    tooltip: {
      trigger: cartesian ? "axis" : "item",
      confine: true,
      ...(formatter ? { valueFormatter: formatter } : {}),
      ...tile.chart.tooltip,
    },
    animationDuration: 300,
  };
  if (cartesian)
    option.grid = {
      left: 8,
      right: 12,
      top: tile.chart.legend === undefined ? 16 : 36,
      bottom: 4,
      containLabel: true,
      ...tile.chart.grid,
    };
  if (formatter) {
    option.xAxis = withAxisFormatter(
      tile.chart.xAxis,
      kind === "horizontal_bar",
      formatter,
    );
    option.yAxis = withAxisFormatter(
      tile.chart.yAxis,
      kind !== "horizontal_bar",
      formatter,
    );
  }
  return option;
}

/* ---------- Layout ---------- */
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
function toLayoutItem(tile: DashboardTile): LayoutItem {
  return {
    i: tile.id,
    x: tile.layout.x,
    y: tile.layout.y,
    w: tile.layout.w,
    h: tile.layout.h,
    minW: 2,
    minH: tile.type === "text" || tile.type === "control" ? 1 : 2,
  };
}
export function readingOrder<T extends DashboardTile>(
  tiles: readonly T[],
): T[] {
  return [...tiles].sort(
    (a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x,
  );
}
/** 12 columns on desktop, 8 scaled columns on tablets, one stacked column on phones. */
export function responsiveLayouts(
  tiles: readonly DashboardTile[],
): Record<GridBreakpoint, LayoutItem[]> {
  const lg = tiles.map(toLayoutItem);
  const md = lg.map((item) => {
    const w = clamp(Math.round((item.w * 8) / 12), 1, 8);
    const x = clamp(Math.round((item.x * 8) / 12), 0, 8 - w);
    return { ...item, x, w, minW: 1 };
  });
  let y = 0;
  const xs = readingOrder(tiles).map((tile) => {
    const item = { ...toLayoutItem(tile), x: 0, y, w: 1, minW: 1 };
    y += item.h;
    return item;
  });
  return { lg, md, xs };
}
export function applyLayout(
  tiles: readonly DashboardTile[],
  layout: readonly LayoutItem[],
): DashboardTile[] {
  return tiles.map((tile) => {
    const item = layout.find((entry) => entry.i === tile.id);
    if (!item) return tile;
    const w = clamp(Math.round(item.w), 1, 12);
    return {
      ...tile,
      layout: {
        x: clamp(Math.round(item.x), 0, 12 - w),
        y: clamp(Math.round(item.y), 0, 1000),
        w,
        h: clamp(Math.round(item.h), 1, 40),
      },
    };
  });
}
export function layoutChanged(
  tiles: readonly DashboardTile[],
  layout: readonly LayoutItem[],
): boolean {
  return tiles.some((tile) => {
    const item = layout.find((entry) => entry.i === tile.id);
    return (
      item !== undefined &&
      (item.x !== tile.layout.x ||
        item.y !== tile.layout.y ||
        item.w !== tile.layout.w ||
        item.h !== tile.layout.h)
    );
  });
}
const overlaps = (a: DashboardTile["layout"], b: DashboardTile["layout"]) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
/** Lowest, then leftmost, empty rectangle that fits a w by h tile. */
function firstFreeSpot(
  tiles: readonly DashboardTile[],
  w: number,
  h: number,
): { x: number; y: number } {
  const width = clamp(w, 1, 12);
  const bottom = tiles.reduce(
    (max, tile) => Math.max(max, tile.layout.y + tile.layout.h),
    0,
  );
  for (let y = 0; y <= bottom; y++)
    for (let x = 0; x + width <= 12; x++) {
      const candidate = { x, y, w: width, h };
      if (!tiles.some((tile) => overlaps(candidate, tile.layout)))
        return { x, y };
    }
  return { x: 0, y: bottom };
}
function uniqueTileId(base: string, taken: ReadonlySet<string>): string {
  const cleaned = base
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/^[^a-z]+/, "");
  const stem = (cleaned || "tile").slice(0, 36);
  if (!taken.has(stem)) return stem;
  for (let index = 2; index < 1000; index++) {
    const candidate = `${stem}_${String(index)}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${stem}_${String(Date.now() % 1000)}`;
}
export function placeTile(
  definition: DashboardDefinition,
  tile: DashboardTile,
): DashboardTile {
  const taken = new Set(definition.tiles.map((entry) => entry.id));
  const id = uniqueTileId(tile.id, taken);
  const spot = firstFreeSpot(definition.tiles, tile.layout.w, tile.layout.h);
  return { ...tile, id, layout: { ...tile.layout, ...spot } };
}
function missingVariables(
  definition: DashboardDefinition,
  variables: readonly DashboardVariable[],
): DashboardVariable[] {
  const names = new Set(definition.variables.map((variable) => variable.name));
  return variables.filter((variable) => !names.has(variable.name));
}
/** Add a template tile at the first free spot along with the variables it relies on. */
export function addTemplate(
  definition: DashboardDefinition,
  template: DashboardTileTemplate,
): { definition: DashboardDefinition; tile: DashboardTile } {
  const tile = placeTile(definition, template.tile);
  return {
    definition: {
      ...definition,
      variables: [
        ...definition.variables,
        ...missingVariables(definition, template.variables),
      ],
      tiles: [...definition.tiles, tile],
    },
    tile,
  };
}
const usesStandardScope = (definition: DashboardDefinition) =>
  standardDashboardVariables.every((standard) =>
    definition.variables.some(
      (variable) =>
        variable.name === standard.name && variable.type === standard.type,
    ),
  );
export function blankTile(
  definition: DashboardDefinition,
  type: "stat" | "chart" | "table" | "text",
): DashboardTile {
  const where = usesStandardScope(definition)
    ? ` WHERE ${dashboardScopeSql.scope}`
    : "";
  const titles = copy.dashboards.tiles.blankTitles;
  const layout = { x: 0, y: 0 };
  switch (type) {
    case "stat":
      return {
        id: "stat",
        type,
        title: titles.stat,
        layout: { ...layout, w: 3, h: 2 },
        sql: `SELECT count() AS value FROM sessions${where}`,
        unit: "count",
      };
    case "chart":
      return {
        id: "chart",
        type,
        title: titles.chart,
        layout: { ...layout, w: 6, h: 5 },
        sql: `SELECT toDate(started_at) AS day, count() AS sessions FROM sessions${where} GROUP BY day ORDER BY day`,
        chart: buildChart("bar", {
          x: "day",
          ys: ["sessions"],
          legend: false,
          smooth: false,
        }),
      };
    case "table":
      return {
        id: "table",
        type,
        title: titles.table,
        layout: { ...layout, w: 6, h: 5 },
        sql: `SELECT session_id, title, user_email, repo_name, started_at FROM sessions${where} ORDER BY started_at DESC LIMIT 20`,
      };
    default:
      return {
        id: "note",
        type,
        title: titles.text,
        layout: { ...layout, w: 12, h: 2 },
        markdown: copy.dashboards.tiles.blankMarkdown,
      };
  }
}
export function blankDefinition(): DashboardDefinition {
  return { version: 2, variables: [...standardDashboardVariables], tiles: [] };
}
export function duplicateTile(
  definition: DashboardDefinition,
  id: string,
): DashboardDefinition {
  const source = definition.tiles.find((tile) => tile.id === id);
  if (!source) return definition;
  const tile = placeTile(definition, source);
  return { ...definition, tiles: [...definition.tiles, tile] };
}
/** Swap a tile with its neighbour in reading order; phones reorder only this way. */
export function moveTile(
  definition: DashboardDefinition,
  id: string,
  direction: "up" | "down",
): DashboardDefinition {
  const ordered = readingOrder(definition.tiles);
  const index = ordered.findIndex((tile) => tile.id === id);
  const other = ordered[direction === "up" ? index - 1 : index + 1];
  const current = ordered[index];
  if (!current || !other) return definition;
  const swap = (tile: DashboardTile, target: DashboardTile) => ({
    ...tile,
    layout: { ...tile.layout, x: target.layout.x, y: target.layout.y },
  });
  return {
    ...definition,
    tiles: definition.tiles.map((tile) =>
      tile.id === current.id
        ? swap(tile, other)
        : tile.id === other.id
          ? swap(tile, current)
          : tile,
    ),
  };
}
export function replaceTile(
  definition: DashboardDefinition,
  id: string,
  tile: DashboardTile,
): DashboardDefinition {
  return {
    ...definition,
    tiles: definition.tiles.map((entry) => (entry.id === id ? tile : entry)),
  };
}
export function removeTile(
  definition: DashboardDefinition,
  id: string,
): DashboardDefinition {
  return {
    ...definition,
    tiles: definition.tiles.filter((tile) => tile.id !== id),
  };
}
export function variablesKey(values: VariableValues): string {
  return JSON.stringify(
    Object.keys(values)
      .sort()
      .map((key) => [key, values[key]]),
  );
}
export function definitionJson(definition: DashboardDefinition): string {
  return JSON.stringify(definition, null, 2);
}
export function dashboardJson(dashboard: {
  name: string;
  description: string;
  definition: DashboardDefinition;
}): string {
  return JSON.stringify(
    {
      name: dashboard.name,
      description: dashboard.description,
      definition: dashboard.definition,
    },
    null,
    2,
  );
}
