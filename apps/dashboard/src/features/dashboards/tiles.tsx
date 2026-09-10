import {
  ArrowDown,
  ArrowUp,
  Copy,
  Info,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useMemo, useRef, type ReactNode } from "react";
import type { JsonValue } from "@agentcommons/core/schemas/common";
import type {
  DashboardTile,
  DashboardVariable,
  DashboardVariableValue,
} from "@agentcommons/core/schemas/dashboards";
import { copy } from "../../copy";
import {
  columnValueLabel,
  dateTime,
  fieldLabel,
  metricValue,
  number,
  textValue,
} from "../../lib/display";
import { paths } from "../../lib/routes";
import { cn } from "../../lib/utils";
import { EChart } from "../../components/app/echart";
import { Markdown } from "../../components/app/markdown";
import { Button } from "../../components/ui/button";
import {
  Alert,
  EmptyState,
  Skeleton,
  Spinner,
} from "../../components/ui/feedback";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../components/ui/menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table";
import {
  chartOption,
  columnKind,
  hasSql,
  statValues,
  type SqlResult,
  type TileOf,
  type TileResult,
  type VariableValues,
} from "./model";
import { VariableControl } from "./variables";

interface TileActions {
  edit: () => void;
  duplicate: () => void;
  remove: () => void;
  moveUp: (() => void) | null;
  moveDown: (() => void) | null;
}

function StatBody({
  tile,
  result,
}: {
  tile: TileOf<"stat">;
  result: SqlResult;
}) {
  const { value, compare } = statValues(tile, result);
  const delta = value !== null && compare !== null ? value - compare : null;
  return (
    <div className="flex h-full flex-col justify-end gap-1">
      <p className="truncate text-[28px] leading-none font-semibold tracking-tight tabular-nums sm:text-3xl">
        {metricValue(value, tile.unit)}
      </p>
      {delta !== null && (
        <p
          className={cn(
            "text-xs tabular-nums",
            delta > 0
              ? "text-success"
              : delta < 0
                ? "text-danger"
                : "text-muted",
          )}
        >
          {delta > 0 ? "+" : ""}
          {metricValue(delta, tile.unit)}
          <span className="text-muted">
            {copy.app.common.separator}
            {copy.dashboards.tiles.change}
          </span>
        </p>
      )}
    </div>
  );
}
function ChartBody({
  tile,
  result,
}: {
  tile: TileOf<"chart">;
  result: SqlResult;
}) {
  const option = useMemo(() => chartOption(tile, result), [tile, result]);
  if (!option)
    return (
      <EmptyState
        compact
        title={copy.dashboards.tiles.noChartColumns}
        className="h-full"
      />
    );
  return <EChart option={option} className="h-full min-h-0" />;
}
function cellText(
  column: string,
  value: JsonValue | undefined,
  kind: ReturnType<typeof columnKind>,
): string {
  if (value === null || value === undefined) return copy.app.common.unavailable;
  switch (kind) {
    case "number":
      return typeof value === "number" || typeof value === "string"
        ? number(value)
        : textValue(value);
    case "datetime":
      return typeof value === "string" ? dateTime(value) : textValue(value);
    default:
      return typeof value === "string"
        ? columnValueLabel(column, value)
        : textValue(value);
  }
}
function TableTileBody({
  tile,
  result,
}: {
  tile: TileOf<"table">;
  result: SqlResult;
}) {
  const visible = tile.columns?.length
    ? tile.columns
    : result.columns.map((column) => column.name);
  const indexOf = (name: string) =>
    result.columns.findIndex((column) => column.name === name);
  const sessionIndex = indexOf("session_id");
  const titleIndex = indexOf("title");
  const columns = visible
    .map((name) => ({ name, index: indexOf(name) }))
    .filter(
      (column) =>
        column.index >= 0 &&
        !(
          sessionIndex >= 0 &&
          titleIndex >= 0 &&
          column.name === "title" &&
          visible.includes("session_id")
        ),
    )
    .map((column) => {
      const type = result.columns[column.index]?.type ?? "";
      return {
        ...column,
        kind: columnKind(type),
        // The session_id column carries the title as a link, so it is headed "Session".
        label:
          column.name === "session_id" && titleIndex >= 0
            ? fieldLabel("session")
            : fieldLabel(column.name),
      };
    });
  // Numbers and dates take a fixed width; text columns split the rest and truncate with
  // the full value in a tooltip. Phones and tiles under 320 px stack each row into
  // labeled records (the container query in app.css keys on this `tile` container).
  return (
    <Table
      layout="scroll-y"
      containerLabel={tile.title}
      containerClassName="app-scroll @container/tile h-full overflow-auto rounded-md focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
      className="stacked-table text-[13px] [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-surface"
    >
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {columns.map((column) => (
            <TableHead
              key={column.name}
              className={cn(
                "h-8 px-2 first:pl-0 last:pr-0",
                column.kind === "number" && "w-18 text-right",
                column.kind === "date" && "w-24",
                column.kind === "datetime" && "w-40",
              )}
            >
              {column.label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {result.rows.map((row, rowIndex) => (
          <TableRow key={rowIndex}>
            {columns.map((column) => {
              const value = row[column.index];
              if (column.name === "session_id" && typeof value === "string") {
                const title = titleIndex >= 0 ? row[titleIndex] : undefined;
                const text =
                  typeof title === "string" && title.trim() !== ""
                    ? title
                    : value.slice(0, 8);
                return (
                  <TableCell
                    key={column.name}
                    data-label={column.label}
                    className="px-2 py-1.5 first:pl-0 last:pr-0"
                  >
                    <a
                      href={paths.session(value)}
                      className="block truncate text-accent underline-offset-4 hover:underline"
                      title={value}
                    >
                      {text}
                    </a>
                  </TableCell>
                );
              }
              const text = cellText(column.name, value, column.kind);
              return (
                <TableCell
                  key={column.name}
                  data-label={column.label}
                  className={cn(
                    "px-2 py-1.5 first:pl-0 last:pr-0",
                    column.kind === "number" && "text-right tabular-nums",
                  )}
                >
                  <span className="block truncate" title={text}>
                    {text}
                  </span>
                </TableCell>
              );
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
function SqlTileBody({
  tile,
  result,
  loading,
}: {
  tile: TileOf<"stat" | "chart" | "table">;
  result: TileResult | undefined;
  loading: boolean;
}) {
  if (result?.error)
    return (
      <Alert
        variant="danger"
        title={copy.dashboards.tiles.errorTitle}
        className="text-xs"
      >
        <span className="font-mono break-words">{result.error.message}</span>
      </Alert>
    );
  if (!result?.result) {
    if (!loading && result === undefined && tile.type === "stat")
      return <StatSkeleton />;
    return tile.type === "stat" ? (
      <StatSkeleton />
    ) : (
      <div className="flex h-full flex-col gap-2">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="min-h-8 flex-1" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    );
  }
  const data = result.result;
  if (data.rows.length === 0)
    return tile.type === "stat" ? (
      <StatBody tile={tile} result={data} />
    ) : (
      <EmptyState
        compact
        className="h-full py-4"
        title={copy.dashboards.tiles.empty}
        description={copy.dashboards.tiles.emptyHint}
      />
    );
  switch (tile.type) {
    case "stat":
      return <StatBody tile={tile} result={data} />;
    case "chart":
      return <ChartBody tile={tile} result={data} />;
    case "table":
      return <TableTileBody tile={tile} result={data} />;
  }
}
function StatSkeleton() {
  return (
    <div className="flex h-full flex-col justify-end gap-2">
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-3 w-1/3" />
    </div>
  );
}
function IconButton({
  label,
  onClick,
  children,
  className,
  disabled,
}: {
  label: string;
  onClick?: (() => void) | undefined;
  children: ReactNode;
  className?: string | undefined;
  disabled?: boolean | undefined;
}) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={cn("size-7 text-muted", className)}
      aria-label={label}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
    >
      {children}
    </Button>
  );
}
/** One tile: header with title, description and actions, body by tile type. */
export function DashboardTileCard({
  tile,
  result,
  loading,
  refreshing,
  editing,
  selected,
  onRefresh,
  actions,
  variables,
  values,
  onVariableChange,
}: {
  tile: DashboardTile;
  result: TileResult | undefined;
  loading: boolean;
  refreshing: boolean;
  editing: boolean;
  selected?: boolean | undefined;
  onRefresh?: (() => void) | undefined;
  actions?: TileActions | undefined;
  variables: readonly DashboardVariable[];
  values: VariableValues;
  onVariableChange: (name: string, value: DashboardVariableValue) => void;
}) {
  const sql = hasSql(tile);
  const variable =
    tile.type === "control"
      ? variables.find((entry) => entry.name === tile.variable)
      : undefined;
  // The header is also the drag handle; a drag that ends on it must not open the inspector.
  const pressed = useRef<{ x: number; y: number } | null>(null);
  return (
    <article
      aria-label={tile.title}
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-surface text-fg",
        editing && "transition-shadow",
        selected && "border-accent ring-2 ring-accent/30",
      )}
    >
      <header
        className={cn(
          "flex shrink-0 items-center gap-1.5 px-4 pt-2.5 pb-1.5",
          editing && "tile-drag-handle select-none",
        )}
        onPointerDown={(event) => {
          // The tile menu renders in a portal: its events reach this handler through
          // React's tree, not the DOM. Only presses on the header itself count.
          if (!event.currentTarget.contains(event.target as Node)) return;
          pressed.current = { x: event.clientX, y: event.clientY };
        }}
        onClick={(event) => {
          if (!editing || !actions) return;
          if (!event.currentTarget.contains(event.target as Node)) return;
          const start = pressed.current;
          pressed.current = null;
          // A click without its own press here, or one that dragged, does not select.
          if (!start) return;
          if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4)
            return;
          actions.edit();
        }}
      >
        <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold">
          {tile.title}
        </h3>
        {tile.description && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="flex size-6 shrink-0 cursor-help items-center justify-center rounded text-subtle hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
                aria-label={copy.dashboards.tiles.about}
                onClick={(event) => {
                  event.stopPropagation();
                }}
              >
                <Info size={14} aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{tile.description}</TooltipContent>
          </Tooltip>
        )}
        {sql && onRefresh && (
          <IconButton
            label={copy.dashboards.tiles.refresh}
            onClick={onRefresh}
            disabled={refreshing}
          >
            {refreshing ? (
              <Spinner size={14} />
            ) : (
              <RefreshCw size={14} aria-hidden />
            )}
          </IconButton>
        )}
        {editing && actions && (
          <>
            <IconButton
              label={copy.dashboards.tiles.edit}
              onClick={actions.edit}
            >
              <Pencil size={14} aria-hidden />
            </IconButton>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-7 text-muted"
                  aria-label={copy.dashboards.tiles.actions}
                  onClick={(event) => {
                    event.stopPropagation();
                  }}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                  }}
                >
                  <MoreHorizontal size={14} aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={actions.duplicate}>
                  <Copy aria-hidden />
                  {copy.app.common.duplicate}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!actions.moveUp}
                  {...(actions.moveUp ? { onSelect: actions.moveUp } : {})}
                >
                  <ArrowUp aria-hidden />
                  {copy.dashboards.tiles.moveUp}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!actions.moveDown}
                  {...(actions.moveDown ? { onSelect: actions.moveDown } : {})}
                >
                  <ArrowDown aria-hidden />
                  {copy.dashboards.tiles.moveDown}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem destructive onSelect={actions.remove}>
                  <Trash2 aria-hidden />
                  {copy.dashboards.tiles.delete}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </header>
      <div className="app-scroll min-h-0 flex-1 overflow-hidden px-4 pb-3">
        {sql ? (
          <SqlTileBody tile={tile} result={result} loading={loading} />
        ) : tile.type === "text" ? (
          <div
            tabIndex={0}
            role="region"
            aria-label={tile.title}
            className="app-scroll h-full overflow-y-auto rounded-md focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
          >
            <Markdown content={tile.markdown} className="text-sm" />
          </div>
        ) : variable ? (
          <div
            tabIndex={0}
            role="region"
            aria-label={tile.title}
            className="app-scroll h-full overflow-y-auto pt-1 rounded-md focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
          >
            <VariableControl
              variable={variable}
              value={values[variable.name]}
              onChange={(value) => {
                onVariableChange(variable.name, value);
              }}
            />
          </div>
        ) : (
          <Alert variant="warning" className="text-xs">
            {copy.dashboards.tiles.noVariable}
          </Alert>
        )}
      </div>
    </article>
  );
}
