import { useMemo, useState, type ReactNode } from "react";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { EChartsCoreOption } from "echarts/core";
import type { z } from "zod";
import { Power, PowerOff } from "lucide-react";
import type { MetricUnit } from "@agentcommons/core/schemas/common";
import type { HookManifest } from "@agentcommons/core/schemas/ingest";
import {
  metricGroups,
  type MetricRow,
} from "@agentcommons/core/schemas/metrics";
import {
  installationSortKeys,
  type installationSchema,
} from "@agentcommons/core/schemas/rest";
import { copy } from "../../copy";
import { api, unwrap } from "../../lib/api/client";
import {
  dateTime,
  metricColumnLabel,
  harnessLabel,
  metricValue,
  number,
  textValue,
} from "../../lib/display";
import { useHookManifest } from "../../lib/use-hook-manifest";
import { useWorkspace } from "../../components/app/workspace";
import { ConfirmDialog } from "../../components/app/confirm-dialog";
import { DataTable } from "../../components/app/data-table";
import { Disclosure, Stat, StatGrid } from "../../components/app/display";
import { EChart } from "../../components/app/echart";
import {
  LoadingState,
  QueryState,
  RequestError,
} from "../../components/app/states";
import { Badge } from "../../components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { EmptyState } from "../../components/ui/feedback";
import { Input, NativeSelect } from "../../components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../components/ui/menu";
import { useListPage } from "./list";
import {
  BooleanFilterSelect,
  FilterBar,
  countActive,
  without,
} from "./filters";
import { RowMenu, actionsHeader } from "./row-menu";

export interface MetricFilters {
  date_from: string;
  date_to: string;
  repo_name?: string;
}
type HealthMetric = (typeof metricGroups.health)[number];
const healthMetrics = metricGroups.health;
const text = copy.admin.status;
const dimension = (key: keyof MetricRow) => metricColumnLabel(key);
const toolsLabel = (enabled: boolean | null) =>
  enabled === null
    ? null
    : enabled
      ? copy.admin.installations.toolsEnabled
      : copy.admin.installations.toolsDisabled;
const harnessName = (value: string | null) =>
  value === null ? null : harnessLabel(value);
const seriesName = (row: MetricRow) =>
  [
    row.repo_name,
    harnessName(row.harness),
    row.user_id,
    row.tool,
    row.policy_id,
    toolsLabel(row.tools_enabled),
  ]
    .filter(
      (value): value is string => typeof value === "string" && value !== "",
    )
    .join(copy.app.common.separator);
const sum = (values: number[]) =>
  values.reduce((total, value) => total + value, 0);
/**
 * Bars for additive units, lines otherwise. Up to six series keep their dimensions; more
 * collapse into one series per date so the chart stays readable.
 */
function buildMetricChart(
  rows: readonly MetricRow[],
  fallbackName: string,
): { option: EChartsCoreOption; unit: MetricUnit; collapsed: number } {
  const unit = rows[0]?.unit ?? "count";
  const additive = unit === "count" || unit === "tokens";
  const dates = [...new Set(rows.map((row) => row.date ?? ""))].sort();
  const groups = new Map<string, MetricRow[]>();
  for (const row of rows) {
    const key = seriesName(row) || fallbackName;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const aggregate = (list: MetricRow[]): number | null => {
    const values = list
      .map((row) => row.value)
      .filter((value): value is number => value !== null);
    if (values.length === 0) return null;
    if (additive) return sum(values);
    if (unit === "ratio") {
      const numerators = list.map((row) => row.numerator);
      const denominators = list.map((row) => row.denominator);
      if (
        numerators.every((value): value is number => value !== null) &&
        denominators.every((value): value is number => value !== null)
      ) {
        const denominator = sum(denominators);
        return denominator > 0 ? sum(numerators) / denominator : null;
      }
    }
    return sum(values) / values.length;
  };
  const collapse = groups.size > 6;
  const forDates = (list: readonly MetricRow[]) =>
    dates.map((date) =>
      aggregate(list.filter((row) => (row.date ?? "") === date)),
    );
  const series = collapse
    ? [
        {
          name: fallbackName,
          type: additive ? "bar" : "line",
          data: forDates(rows),
        },
      ]
    : [...groups.entries()].map(([name, list]) => ({
        name,
        type: additive ? "bar" : "line",
        ...(additive ? { stack: "total" } : {}),
        data: forDates(list),
      }));
  const option: EChartsCoreOption = {
    grid: {
      left: 8,
      right: 12,
      top: series.length > 1 ? 40 : 16,
      bottom: 8,
      containLabel: true,
    },
    legend: series.length > 1 ? { type: "scroll", top: 0 } : { show: false },
    tooltip: {
      trigger: "axis",
      valueFormatter: (value: unknown) =>
        metricValue(typeof value === "number" ? value : null, unit),
    },
    xAxis: {
      type: "category",
      data: dates.map((date) => date || copy.app.common.unavailable),
    },
    yAxis: {
      type: "value",
      axisLabel: {
        formatter: (value: number) =>
          metricValue(value, unit, { compact: true }),
      },
    },
    series,
  };
  return { option, unit, collapsed: collapse ? groups.size : 0 };
}

/** The date range and repository filter sits inside this card: it scopes only these metrics. */
export function HealthMetricsCard({
  filters,
  toolbar,
}: {
  filters: MetricFilters;
  toolbar?: ReactNode;
}) {
  const { organization } = useWorkspace();
  const [metric, setMetric] = useState<HealthMetric>(healthMetrics[0]);
  const queryFilters = { ...filters, metric };
  const fetchPage = async (
    cursor: string | null,
    limit: number,
    signal: AbortSignal,
  ) =>
    unwrap(
      await api.GET("/api/v1/admin/metrics/{group}", {
        params: {
          path: { group: "health" },
          query: {
            filters: queryFilters,
            cursor,
            sort: "date",
            order: "asc",
            limit,
            format: "json",
          },
        },
        signal,
      }),
    );
  const query = useQuery({
    queryKey: [organization.id, "admin", "metrics", "health", queryFilters],
    queryFn: ({ signal }) => fetchPage(null, 100, signal),
    placeholderData: keepPreviousData,
  });
  const rows = query.data?.items ?? [];
  const more = (query.data?.cursor ?? null) !== null;
  const label = text.metrics[metric];
  const chart = useMemo(() => buildMetricChart(rows, label), [rows, label]);
  const columns = useMemo<ColumnDef<MetricRow>[]>(
    () => [
      {
        accessorKey: "date",
        header: dimension("date"),
        size: 100,
        cell: ({ row }) => textValue(row.original.date),
      },
      {
        accessorKey: "value",
        header: dimension("value"),
        size: 90,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {metricValue(row.original.value, row.original.unit)}
          </span>
        ),
      },
      {
        accessorKey: "repo_name",
        header: dimension("repo_name"),
        size: 170,
        cell: ({ row }) => textValue(row.original.repo_name),
      },
      {
        accessorKey: "harness",
        header: dimension("harness"),
        size: 100,
        cell: ({ row }) =>
          harnessName(row.original.harness) ?? copy.app.common.unavailable,
      },
      {
        accessorKey: "user_id",
        header: dimension("user_id"),
        size: 200,
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {textValue(row.original.user_id)}
          </span>
        ),
      },
      {
        accessorKey: "tool",
        header: dimension("tool"),
        size: 120,
        cell: ({ row }) => textValue(row.original.tool),
      },
      {
        accessorKey: "policy_id",
        header: dimension("policy_id"),
        size: 200,
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {textValue(row.original.policy_id)}
          </span>
        ),
      },
      {
        accessorKey: "tools_enabled",
        header: dimension("tools_enabled"),
        size: 90,
        cell: ({ row }) =>
          toolsLabel(row.original.tools_enabled) ?? copy.app.common.unavailable,
      },
      {
        accessorKey: "numerator",
        header: dimension("numerator"),
        size: 80,
        cell: ({ row }) => number(row.original.numerator),
      },
      {
        accessorKey: "denominator",
        header: dimension("denominator"),
        size: 80,
        cell: ({ row }) => number(row.original.denominator),
      },
      {
        accessorKey: "unit",
        header: dimension("unit"),
        size: 80,
        cell: ({ row }) => copy.app.units[row.original.unit],
      },
    ],
    [],
  );
  return (
    <Card data-testid="admin-status-health">
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>{text.health}</CardTitle>
          <CardDescription>{text.healthDescription}</CardDescription>
        </div>
        <NativeSelect
          aria-label={text.metric}
          className="w-full sm:w-72"
          value={metric}
          onChange={(event) => {
            const next = healthMetrics.find(
              (value) => value === event.target.value,
            );
            if (next) setMetric(next);
          }}
        >
          {healthMetrics.map((value) => (
            <option key={value} value={value}>
              {text.metrics[value]}
            </option>
          ))}
        </NativeSelect>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {toolbar}
        {query.error ? (
          <RequestError
            error={query.error}
            retry={() => {
              void query.refetch();
            }}
          />
        ) : query.isPending ? (
          <LoadingState rows={2} />
        ) : rows.length === 0 ? (
          <EmptyState
            compact
            title={text.chartEmpty}
            description={text.chartEmptyHint}
          />
        ) : (
          <>
            <div
              role="img"
              aria-label={label}
              className={query.isFetching ? "opacity-60" : ""}
            >
              <EChart option={chart.option} className="h-64" />
            </div>
            {(chart.collapsed > 0 || more) && (
              <p className="text-xs text-muted">
                {chart.collapsed > 0 ? text.combined(chart.collapsed) : null}
                {chart.collapsed > 0 && more ? copy.app.common.separator : null}
                {more ? text.truncated : null}
              </p>
            )}
          </>
        )}
        {rows.length > 0 && (
          <Disclosure showLabel={text.showTable} hideLabel={text.hideTable}>
            <DataTable
              data={rows}
              columns={columns}
              label={text.observations}
              compact
              hiddenColumns={[
                "user_id",
                "tool",
                "policy_id",
                "tools_enabled",
                "numerator",
                "denominator",
                "unit",
              ]}
              rowId={(_row, index) => String(index)}
              csv={{
                name: text.csvName,
                fetchAll: (cursor, signal) => fetchPage(cursor, 100, signal),
              }}
            />
          </Disclosure>
        )}
      </CardContent>
    </Card>
  );
}

export function SnapshotCards({ embeddings }: { embeddings: boolean }) {
  const { organization } = useWorkspace();
  const query = useQuery({
    queryKey: [organization.id, "admin", "status"],
    queryFn: async ({ signal }) =>
      unwrap(await api.GET("/api/v1/admin/status", { signal })),
    refetchInterval: 30_000,
  });
  return (
    <section className="flex flex-col gap-3" aria-label={text.snapshot}>
      <div>
        <h2 className="text-[15px] leading-tight font-semibold">
          {text.snapshot}
        </h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">
          {text.snapshotHint}
        </p>
      </div>
      <QueryState query={query} rows={1}>
        {(data) => (
          <StatGrid
            data-testid="admin-status-snapshot"
            className={
              embeddings ? "sm:grid-cols-3 lg:grid-cols-6" : "sm:grid-cols-3"
            }
          >
            <Stat
              label={text.server}
              value={
                <span className="font-mono text-lg" title={data.server.version}>
                  {data.server.version}
                </span>
              }
              hint={
                data.server.auto_update ? text.autoUpdateOn : text.autoUpdateOff
              }
            />
            <Stat label={text.queue} value={number(data.queue_depth)} />
            <Stat
              label={text.failed}
              value={number(data.projection.failed_sessions)}
            />
            {embeddings && (
              <>
                <Stat
                  label={text.backlog}
                  value={number(data.embedding_backlog)}
                />
                <Stat
                  label={text.tokens}
                  value={number(data.embedding_daily_tokens)}
                />
                <Stat
                  label={text.cost}
                  value={metricValue(Number(data.embedding_daily_cost), "usd")}
                />
              </>
            )}
          </StatGrid>
        )}
      </QueryState>
    </section>
  );
}

type Installation = z.infer<typeof installationSchema>;
type InstallationFilters = { hostname?: string; tools_enabled?: boolean };
/**
 * Whether a machine runs the hook this instance serves. The badge waits for the manifest;
 * the short digest shows as soon as the row does.
 */
function HookState({
  digest,
  manifest,
}: {
  digest: string | null;
  manifest: HookManifest | null;
}) {
  const words = copy.admin.installations;
  if (digest === null)
    return <Badge variant="neutral">{words.hookUnknown}</Badge>;
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      {manifest === null ? null : digest === manifest.sha256 ? (
        <Badge variant="neutral">{words.hookCurrent}</Badge>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="warning" tabIndex={0} className="cursor-help">
              {words.hookPending}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>{words.hookPendingHint}</TooltipContent>
        </Tooltip>
      )}
      <span className="font-mono text-xs" title={digest}>
        {digest.slice(0, 8)}
      </span>
    </span>
  );
}
export function InstallationsCard() {
  const { organization } = useWorkspace();
  const client = useQueryClient();
  const words = copy.admin.installations;
  const manifest = useHookManifest().data ?? null;
  const [hostDraft, setHostDraft] = useState("");
  const [selected, setSelected] = useState<Installation | null>(null);
  const queryKey = [organization.id, "admin", "installations"];
  const list = useListPage<
    Installation,
    (typeof installationSortKeys)[number],
    InstallationFilters
  >({
    queryKey,
    initialSort: "last_seen_at",
    sortKeys: installationSortKeys,
    csvName: words.csvName,
    fetchPage: async (request, signal) =>
      unwrap(
        await api.GET("/api/v1/installations", {
          params: { query: { ...request, format: "json" } },
          signal,
        }),
      ),
  });
  const { filters } = list;
  const columns = useMemo<ColumnDef<Installation>[]>(
    () => [
      {
        accessorKey: "hostname",
        header: words.host,
        size: 180,
        cell: ({ row }) => (
          <span className="font-medium">{row.original.hostname}</span>
        ),
      },
      {
        accessorKey: "tools_enabled",
        header: words.tools,
        size: 100,
        cell: ({ row }) => (
          <Badge variant={row.original.tools_enabled ? "success" : "warning"}>
            {row.original.tools_enabled
              ? words.toolsEnabled
              : words.toolsDisabled}
          </Badge>
        ),
      },
      {
        accessorKey: "hook_sha256",
        header: words.hook,
        enableSorting: false,
        size: 150,
        cell: ({ row }) => (
          <HookState digest={row.original.hook_sha256} manifest={manifest} />
        ),
      },
      {
        accessorKey: "session_count",
        header: words.sessions,
        size: 80,
        cell: ({ row }) => number(row.original.session_count),
      },
      {
        accessorKey: "last_seen_at",
        header: words.lastSeen,
        size: 120,
        cell: ({ row }) => dateTime(row.original.last_seen_at),
      },
      {
        accessorKey: "first_seen_at",
        header: words.firstSeen,
        size: 120,
        cell: ({ row }) => dateTime(row.original.first_seen_at),
      },
      { accessorKey: "os_user", header: copy.app.fields.os_user, size: 100 },
      { accessorKey: "platform", header: copy.app.fields.platform, size: 90 },
      { accessorKey: "arch", header: copy.app.fields.arch, size: 80 },
      {
        accessorKey: "installation_id",
        header: copy.app.fields.installation_id,
        enableSorting: false,
        size: 220,
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {row.original.installation_id}
          </span>
        ),
      },
      {
        id: "actions",
        header: actionsHeader,
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <RowMenu
            label={copy.app.common.actions}
            items={[
              {
                label: row.original.tools_enabled
                  ? words.disable
                  : words.enable,
                icon: row.original.tools_enabled ? PowerOff : Power,
                onSelect: () => {
                  setSelected(row.original);
                },
              },
            ]}
          />
        ),
      },
    ],
    [words, manifest],
  );
  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>{words.title}</CardTitle>
          <CardDescription>{words.description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <div data-testid="admin-installations-table">
          <DataTable
            {...list.table}
            columns={columns}
            label={words.title}
            compact
            hiddenColumns={[
              "first_seen_at",
              "os_user",
              "platform",
              "arch",
              "installation_id",
            ]}
            rowId={(row) => row.installation_id}
            emptyTitle={words.empty}
            emptyDescription={words.emptyHint}
            toolbar={
              <FilterBar
                label={copy.app.common.filters}
                activeCount={countActive(filters)}
                onApply={() => {
                  const rest = without(filters, "hostname");
                  const hostname = hostDraft.trim();
                  list.setFilters(hostname ? { ...rest, hostname } : rest);
                }}
                onClear={() => {
                  setHostDraft("");
                  list.setFilters({});
                }}
                controls={[
                  {
                    id: "host",
                    label: words.host,
                    width: "sm:w-52",
                    render: (props) => (
                      <Input
                        {...props}
                        type="search"
                        placeholder={words.host}
                        value={hostDraft}
                        onChange={(event) => {
                          setHostDraft(event.target.value);
                        }}
                      />
                    ),
                  },
                  {
                    id: "tools",
                    label: words.tools,
                    width: "sm:w-40",
                    render: (props) => (
                      <BooleanFilterSelect
                        {...props}
                        value={filters.tools_enabled}
                        labels={{
                          all: words.allStates,
                          on: words.toolsEnabled,
                          off: words.toolsDisabled,
                        }}
                        onChange={(next) => {
                          list.setFilter("tools_enabled", next);
                        }}
                      />
                    ),
                  },
                ]}
              />
            }
          />
        </div>
      </CardContent>
      <ConfirmDialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        title={selected?.tools_enabled ? words.disableTitle : words.enableTitle}
        description={
          selected
            ? selected.tools_enabled
              ? words.disableDescription(selected.hostname)
              : words.enableDescription(selected.hostname)
            : ""
        }
        confirmLabel={selected?.tools_enabled ? words.disable : words.enable}
        destructive={false}
        action={async (reason) => {
          if (!selected) return;
          unwrap(
            await api.POST("/api/v1/admin/installations/{id}/tools", {
              params: { path: { id: selected.installation_id } },
              body: { enabled: !selected.tools_enabled, reason },
            }),
          );
          await Promise.all([
            client.invalidateQueries({ queryKey }),
            client.invalidateQueries({
              queryKey: [organization.id, "admin", "metrics"],
            }),
          ]);
        }}
      />
    </Card>
  );
}
