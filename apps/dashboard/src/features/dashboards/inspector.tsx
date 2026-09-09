import { Play } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { z } from "zod";
import { metricUnitSchema } from "@agentcommons/core/schemas/common";
import {
  dashboardTileSchema,
  type DashboardDefinition,
  type DashboardTile,
} from "@agentcommons/core/schemas/dashboards";
import { dashboardParameterTypes } from "@agentcommons/core/dashboards";
import { copy } from "../../copy";
import { number } from "../../lib/display";
import { cn } from "../../lib/utils";
import { Markdown } from "../../components/app/markdown";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogTitle,
  SheetContent,
} from "../../components/ui/dialog";
import { CheckboxField, Field, Label, Switch } from "../../components/ui/field";
import { Alert, Spinner } from "../../components/ui/feedback";
import { Input, NativeSelect, Textarea } from "../../components/ui/input";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../../components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table";
import {
  buildChart,
  chartBindings,
  chartKind,
  hasSql,
  type ChartKind,
  type SqlResult,
  type TileOf,
  type TileResult,
} from "./model";

export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.map(String).join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}
/** Set or drop an optional property so exact optional types stay honest. */
function withOptional<T extends object>(
  base: T,
  key: keyof T & string,
  value: unknown,
): T {
  const entries = Object.entries(base).filter(([name]) => name !== key);
  if (value !== undefined) entries.push([key, value]);
  return Object.fromEntries(entries) as T;
}
const kinds = Object.keys(copy.dashboards.inspector.kinds) as ChartKind[];

function ColumnSelect({
  label,
  value,
  columns,
  onChange,
  emptyLabel,
}: {
  label: string;
  value: string | undefined;
  columns: readonly string[];
  onChange: (value: string | undefined) => void;
  emptyLabel: string;
}) {
  const options =
    value !== undefined && !columns.includes(value)
      ? [value, ...columns]
      : columns;
  return (
    <Field label={label}>
      {(props) => (
        <NativeSelect
          {...props}
          value={value ?? ""}
          onChange={(event) => {
            onChange(
              event.target.value === "" ? undefined : event.target.value,
            );
          }}
        >
          <option value="">{emptyLabel}</option>
          {options.map((column) => (
            <option key={column} value={column}>
              {column}
            </option>
          ))}
        </NativeSelect>
      )}
    </Field>
  );
}
function ColumnChecklist({
  label,
  hint,
  columns,
  selected,
  onChange,
}: {
  label: string;
  hint?: string | undefined;
  columns: readonly string[];
  selected: readonly string[];
  onChange: (next: string[]) => void;
}) {
  const all = [...new Set([...selected, ...columns])];
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-[13px] font-medium">{label}</legend>
      {all.length === 0 ? (
        <p className="text-xs text-muted">
          {copy.dashboards.inspector.needColumns}
        </p>
      ) : (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {all.map((column) => (
            <CheckboxField
              key={column}
              label={column}
              checked={selected.includes(column)}
              onCheckedChange={(checked) => {
                onChange(
                  checked === true
                    ? [...selected, column]
                    : selected.filter((entry) => entry !== column),
                );
              }}
            />
          ))}
        </div>
      )}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </fieldset>
  );
}
function UnitSelect({
  value,
  allowNone,
  onChange,
}: {
  value: string | undefined;
  allowNone: boolean;
  onChange: (value: z.infer<typeof metricUnitSchema> | undefined) => void;
}) {
  return (
    <Field label={copy.dashboards.inspector.unit}>
      {(props) => (
        <NativeSelect
          {...props}
          value={value ?? ""}
          onChange={(event) => {
            const parsed = metricUnitSchema.safeParse(event.target.value);
            onChange(parsed.success ? parsed.data : undefined);
          }}
        >
          {allowNone && (
            <option value="">{copy.dashboards.inspector.none}</option>
          )}
          {metricUnitSchema.options.map((unit) => (
            <option key={unit} value={unit}>
              {copy.app.units[unit]}
            </option>
          ))}
        </NativeSelect>
      )}
    </Field>
  );
}
function PreviewTable({ result }: { result: SqlResult }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-muted">
        {number(result.row_count)} {copy.dashboards.inspector.previewRows}
        {copy.app.common.separator}
        {number(Math.round(result.duration_ms))}{" "}
        {copy.dashboards.inspector.previewDuration}
        {result.capped
          ? `${copy.app.common.separator}${copy.dashboards.tiles.capped}`
          : ""}
      </p>
      <Table
        containerLabel={copy.dashboards.inspector.preview}
        containerClassName="app-scroll max-h-56 overflow-auto rounded-md border border-line focus-visible:outline-2 focus-visible:outline-accent"
        className="text-xs [&_th]:sticky [&_th]:top-0 [&_th]:bg-surface"
      >
        <TableHeader>
          <TableRow>
            {result.columns.map((column) => (
              <TableHead key={column.name} className="h-8">
                <span className="font-mono">{column.name}</span>
                <span className="ml-1 font-normal text-subtle">
                  {column.type}
                </span>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.rows.slice(0, 50).map((row, index) => (
            <TableRow key={index}>
              {row.map((cell, cellIndex) => (
                <TableCell
                  key={cellIndex}
                  className="max-w-56 truncate py-1 font-mono"
                >
                  {cell === null
                    ? copy.app.common.unavailable
                    : typeof cell === "string"
                      ? cell
                      : JSON.stringify(cell)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
function DataTab({
  tile,
  definition,
  preview,
  previewing,
  onChange,
  onPreview,
}: {
  tile: TileOf<"stat" | "chart" | "table">;
  definition: DashboardDefinition;
  preview: TileResult | undefined;
  previewing: boolean;
  onChange: (tile: DashboardTile) => void;
  onPreview: () => void;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const parameters = Object.entries(
    dashboardParameterTypes(definition.variables),
  );
  const insert = (snippet: string) => {
    const element = textarea.current;
    const start = element?.selectionStart ?? tile.sql.length;
    const end = element?.selectionEnd ?? tile.sql.length;
    const sql = `${tile.sql.slice(0, start)}${snippet}${tile.sql.slice(end)}`;
    onChange({ ...tile, sql });
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(
        start + snippet.length,
        start + snippet.length,
      );
    });
  };
  return (
    <div className="flex flex-col gap-4">
      <Field
        label={copy.dashboards.inspector.sql}
        hint={copy.dashboards.inspector.sqlHint}
      >
        {(props) => (
          <Textarea
            {...props}
            ref={textarea}
            data-testid="tile-sql"
            className="min-h-40 font-mono text-[12.5px]"
            spellCheck={false}
            value={tile.sql}
            onChange={(event) => {
              onChange({ ...tile, sql: event.target.value });
            }}
          />
        )}
      </Field>
      {parameters.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">
            {copy.dashboards.inspector.parameters}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {parameters.map(([name, type]) => {
              const snippet = `{${name}:${type}}`;
              return (
                <button
                  key={name}
                  type="button"
                  className="cursor-pointer rounded-full border border-line bg-raised px-2 py-0.5 font-mono text-[11px] text-fg hover:border-accent focus-visible:outline-2 focus-visible:outline-accent"
                  onClick={() => {
                    insert(snippet);
                  }}
                >
                  {snippet}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div>
        <Button
          size="sm"
          variant="secondary"
          data-testid="tile-preview"
          disabled={previewing}
          onClick={onPreview}
        >
          {previewing ? <Spinner size={14} /> : <Play aria-hidden />}
          {previewing
            ? copy.dashboards.inspector.running
            : copy.dashboards.inspector.runPreview}
        </Button>
      </div>
      {preview?.error && (
        <Alert variant="danger" title={copy.dashboards.tiles.errorTitle}>
          <span className="font-mono text-xs break-words">
            {preview.error.message}
          </span>
        </Alert>
      )}
      {preview?.result ? (
        <PreviewTable result={preview.result} />
      ) : (
        !preview?.error && (
          <p className="text-xs text-muted">
            {copy.dashboards.inspector.previewEmpty}
          </p>
        )
      )}
    </div>
  );
}
function StatVisual({
  tile,
  columns,
  onChange,
}: {
  tile: TileOf<"stat">;
  columns: readonly string[];
  onChange: (tile: DashboardTile) => void;
}) {
  return (
    <>
      <ColumnSelect
        label={copy.dashboards.inspector.valueColumn}
        value={tile.value}
        columns={columns}
        emptyLabel={copy.dashboards.inspector.autoColumn}
        onChange={(value) => {
          onChange(withOptional(tile, "value", value));
        }}
      />
      <UnitSelect
        value={tile.unit}
        allowNone={false}
        onChange={(unit) => {
          onChange({ ...tile, unit: unit ?? "count" });
        }}
      />
      <ColumnSelect
        label={copy.dashboards.inspector.compareColumn}
        value={tile.compare}
        columns={columns}
        emptyLabel={copy.dashboards.inspector.none}
        onChange={(value) => {
          onChange(withOptional(tile, "compare", value));
        }}
      />
    </>
  );
}
function ChartVisual({
  tile,
  columns,
  onChange,
}: {
  tile: TileOf<"chart">;
  columns: readonly string[];
  onChange: (tile: DashboardTile) => void;
}) {
  const kind = chartKind(tile.chart);
  const bindings = chartBindings(tile.chart);
  const rebuild = (nextKind: ChartKind, next: Partial<typeof bindings>) => {
    onChange({
      ...tile,
      chart: buildChart(nextKind, { ...bindings, ...next }),
    });
  };
  const pie = kind === "pie";
  return (
    <>
      <Field label={copy.dashboards.inspector.chartKind}>
        {(props) => (
          <NativeSelect
            {...props}
            value={kind}
            onChange={(event) => {
              const next =
                kinds.find((entry) => entry === event.target.value) ?? "line";
              rebuild(
                next,
                next === "pie" ? { ys: bindings.ys.slice(0, 1) } : {},
              );
            }}
          >
            {kinds.map((entry) => (
              <option key={entry} value={entry}>
                {copy.dashboards.inspector.kinds[entry]}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
      <ColumnSelect
        label={
          pie
            ? copy.dashboards.inspector.nameColumn
            : copy.dashboards.inspector.xColumn
        }
        value={bindings.x}
        columns={columns}
        emptyLabel={copy.dashboards.inspector.none}
        onChange={(x) => {
          rebuild(kind, { x });
        }}
      />
      {pie ? (
        <ColumnSelect
          label={copy.dashboards.inspector.valueColumns}
          value={bindings.ys[0]}
          columns={columns}
          emptyLabel={copy.dashboards.inspector.none}
          onChange={(y) => {
            rebuild(kind, { ys: y === undefined ? [] : [y] });
          }}
        />
      ) : (
        <ColumnChecklist
          label={copy.dashboards.inspector.yColumns}
          columns={columns}
          selected={bindings.ys}
          onChange={(ys) => {
            rebuild(kind, { ys });
          }}
        />
      )}
      {!pie && (
        <ColumnSelect
          label={copy.dashboards.inspector.seriesBy}
          value={tile.series_by}
          columns={columns}
          emptyLabel={copy.dashboards.inspector.none}
          onChange={(value) => {
            onChange(withOptional(tile, "series_by", value));
          }}
        />
      )}
      <UnitSelect
        value={tile.unit}
        allowNone
        onChange={(unit) => {
          onChange(withOptional(tile, "unit", unit));
        }}
      />
      <div className="flex flex-wrap gap-6">
        <label className="flex items-center gap-2 text-[13px] font-medium">
          <Switch
            checked={bindings.legend}
            onCheckedChange={(legend) => {
              rebuild(kind, { legend });
            }}
          />
          {copy.dashboards.inspector.legend}
        </label>
        {(kind === "line" || kind === "area") && (
          <label className="flex items-center gap-2 text-[13px] font-medium">
            <Switch
              checked={bindings.smooth}
              onCheckedChange={(smooth) => {
                rebuild(kind, { smooth });
              }}
            />
            {copy.dashboards.inspector.smooth}
          </label>
        )}
      </div>
    </>
  );
}
function VisualTab({
  tile,
  definition,
  columns,
  onChange,
}: {
  tile: DashboardTile;
  definition: DashboardDefinition;
  columns: readonly string[];
  onChange: (tile: DashboardTile) => void;
}) {
  let specific: ReactNode = null;
  switch (tile.type) {
    case "stat":
      specific = (
        <StatVisual tile={tile} columns={columns} onChange={onChange} />
      );
      break;
    case "chart":
      specific = (
        <ChartVisual tile={tile} columns={columns} onChange={onChange} />
      );
      break;
    case "table":
      specific = (
        <ColumnChecklist
          label={copy.dashboards.inspector.visibleColumns}
          hint={copy.dashboards.inspector.visibleColumnsHint}
          columns={columns}
          selected={tile.columns ?? []}
          onChange={(selected) => {
            onChange(
              withOptional(
                tile,
                "columns",
                selected.length ? selected : undefined,
              ),
            );
          }}
        />
      );
      break;
    case "text":
      specific = (
        <>
          <Field label={copy.dashboards.inspector.markdown}>
            {(props) => (
              <Textarea
                {...props}
                className="min-h-32 font-mono text-[12.5px]"
                value={tile.markdown}
                maxLength={4000}
                onChange={(event) => {
                  onChange({ ...tile, markdown: event.target.value });
                }}
              />
            )}
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">
              {copy.dashboards.inspector.preview}
            </span>
            <div className="rounded-md border border-line px-3 py-2">
              <Markdown content={tile.markdown} className="text-sm" />
            </div>
          </div>
        </>
      );
      break;
    case "control":
      specific = (
        <Field label={copy.dashboards.inspector.variable}>
          {(props) => (
            <NativeSelect
              {...props}
              value={tile.variable}
              onChange={(event) => {
                onChange({ ...tile, variable: event.target.value });
              }}
            >
              {!definition.variables.some(
                (variable) => variable.name === tile.variable,
              ) && <option value={tile.variable}>{tile.variable}</option>}
              {definition.variables.map((variable) => (
                <option key={variable.name} value={variable.name}>
                  {variable.label ?? variable.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      );
      break;
  }
  return (
    <div className="flex flex-col gap-4">
      <Field label={copy.dashboards.inspector.tileTitle}>
        {(props) => (
          <Input
            {...props}
            value={tile.title}
            maxLength={80}
            onChange={(event) => {
              onChange({ ...tile, title: event.target.value });
            }}
          />
        )}
      </Field>
      <Field
        label={copy.dashboards.inspector.description}
        optional={copy.app.common.optional}
      >
        {(props) => (
          <Input
            {...props}
            value={tile.description ?? ""}
            maxLength={200}
            onChange={(event) => {
              onChange(
                withOptional(
                  tile,
                  "description",
                  event.target.value || undefined,
                ),
              );
            }}
          />
        )}
      </Field>
      {specific}
    </div>
  );
}
function AdvancedTab({
  tile,
  onChange,
}: {
  tile: DashboardTile;
  onChange: (tile: DashboardTile) => void;
}) {
  const serialized = JSON.stringify(tile, null, 2);
  const [text, setText] = useState(serialized);
  const [issues, setIssues] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) {
      setText(serialized);
      setIssues([]);
    }
  }, [serialized, dirty]);
  const apply = (value: string) => {
    setText(value);
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch (error) {
      setDirty(true);
      setIssues([error instanceof Error ? error.message : String(error)]);
      return;
    }
    const result = dashboardTileSchema.safeParse(parsed);
    if (!result.success) {
      setDirty(true);
      setIssues(formatIssues(result.error));
      return;
    }
    setIssues([]);
    setDirty(false);
    onChange(result.data);
  };
  return (
    <div className="flex flex-col gap-3">
      <Field
        label={copy.dashboards.inspector.json}
        hint={copy.dashboards.inspector.jsonHint}
      >
        {(props) => (
          <Textarea
            {...props}
            data-testid="tile-json"
            className={cn(
              "min-h-72 font-mono text-[12px]",
              issues.length > 0 && "border-danger",
            )}
            spellCheck={false}
            value={text}
            onChange={(event) => {
              apply(event.target.value);
            }}
          />
        )}
      </Field>
      {issues.length > 0 ? (
        <Alert variant="danger">
          <ul className="list-disc pl-4 font-mono text-xs">
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </Alert>
      ) : (
        <p className="text-xs text-success">
          {copy.dashboards.inspector.jsonValid}
        </p>
      )}
    </div>
  );
}
/** Side panel for one tile: query, visual bindings and the raw JSON. */
export function TileInspector({
  tile,
  definition,
  preview,
  previewing,
  onChange,
  onClose,
  onPreview,
}: {
  tile: DashboardTile | null;
  definition: DashboardDefinition;
  preview: TileResult | undefined;
  previewing: boolean;
  onChange: (tile: DashboardTile) => void;
  onClose: () => void;
  onPreview: (id: string) => void;
}) {
  const columns = preview?.result?.columns.map((column) => column.name) ?? [];
  return (
    <Dialog
      open={tile !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {tile && (
        <SheetContent
          side="right"
          data-testid="tile-inspector"
          className="sm:w-[480px]"
        >
          <div className="flex shrink-0 flex-col gap-1 pr-8">
            <DialogTitle className="flex items-center gap-2 text-base leading-tight font-semibold">
              <span className="truncate">
                {tile.title || copy.dashboards.tiles.untitled}
              </span>
              <Badge variant="outline">
                {copy.dashboards.tiles.types[tile.type]}
              </Badge>
            </DialogTitle>
            <DialogDescription className="font-mono text-xs text-muted">
              {copy.dashboards.editor.tileId}
              {copy.app.common.separator}
              {tile.id}
            </DialogDescription>
          </div>
          <Tabs
            defaultValue={hasSql(tile) ? "data" : "visual"}
            className="shrink-0"
          >
            <TabsList className="shrink-0">
              {hasSql(tile) && (
                <TabsTrigger value="data">
                  {copy.dashboards.inspector.tabs.data}
                </TabsTrigger>
              )}
              <TabsTrigger value="visual">
                {copy.dashboards.inspector.tabs.visual}
              </TabsTrigger>
              <TabsTrigger value="advanced">
                {copy.dashboards.inspector.tabs.advanced}
              </TabsTrigger>
            </TabsList>
            {hasSql(tile) && (
              <TabsContent value="data">
                <DataTab
                  tile={tile}
                  definition={definition}
                  preview={preview}
                  previewing={previewing}
                  onChange={onChange}
                  onPreview={() => {
                    onPreview(tile.id);
                  }}
                />
              </TabsContent>
            )}
            <TabsContent value="visual">
              <VisualTab
                tile={tile}
                definition={definition}
                columns={columns}
                onChange={onChange}
              />
            </TabsContent>
            <TabsContent value="advanced">
              <AdvancedTab key={tile.id} tile={tile} onChange={onChange} />
            </TabsContent>
          </Tabs>
          <Label className="sr-only">{copy.dashboards.inspector.title}</Label>
        </SheetContent>
      )}
    </Dialog>
  );
}
