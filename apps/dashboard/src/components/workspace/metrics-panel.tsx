import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  metricGroups,
  type MetricRow,
} from "@agentcommons/core/schemas/metrics";
import { copy } from "../../copy";
import { api, unwrap } from "../../lib/api/client";
import { metricSortKeys } from "../../lib/api/options";
import { usePagination } from "../../lib/pagination";
import { textValue } from "../../lib/display";
import { useWorkspace } from "./context";
import {
  Field,
  RequestError,
  LoadingState,
  ShortenedFields,
} from "./primitives";
import { DataTable } from "./data-table";
import { MetricChart, metricValue } from "./metric-chart";
import { MetricScope } from "./metric-scope";
export type MetricsFilters = {
  date_from: string;
  date_to: string;
  repo_name?: string;
};
type MetricsProps = {
  group: keyof typeof metricGroups;
  filters: MetricsFilters;
};
export function MetricsPanel({ group, filters }: MetricsProps) {
  const options = metricGroups[group];
  const [selection, setSelection] = useState<MetricRow["metric"]>(
    metricGroups[group][0],
  );
  const metric =
    options.find((value) => value === selection) ?? metricGroups[group][0];
  return (
    <section
      className="metric-section"
      aria-label={copy.workspace.systemStatus.groups[group]}
    >
      <h2>{copy.workspace.systemStatus.groups[group]}</h2>
      <MetricScope
        {...(filters.repo_name ? { repo: filters.repo_name } : {})}
      />
      {group === "reuse" && (
        <p className="field-hint">
          {copy.workspace.systemStatus.reuseDescription}
        </p>
      )}
      {group === "outcomes" && (
        <p className="metric-guidance">
          {copy.workspace.systemStatus.comparisons}
        </p>
      )}
      <Field label={copy.workspace.systemStatus.metric}>
        {(props) => (
          <select
            {...props}
            value={metric}
            onChange={(event) => {
              const next = options.find(
                (value) => value === event.target.value,
              );
              if (next) {
                setSelection(next);
              }
            }}
          >
            {options.map((value) => (
              <option key={value} value={value}>
                {copy.workspace.systemStatus.metrics[value]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <MetricObservations
        key={JSON.stringify({ filters, metric })}
        group={group}
        filters={filters}
        metric={metric}
      />
    </section>
  );
}
function MetricObservations({
  group,
  filters,
  metric,
}: MetricsProps & { metric: MetricRow["metric"] }) {
  const { organization } = useWorkspace();
  const pagination = usePagination("date", metricSortKeys);
  const queryFilters = { ...filters, metric };
  const fetchPage = async (
    cursor: string | null,
    signal: AbortSignal,
    limit = 50,
  ) =>
    unwrap(
      await api.GET("/api/v1/admin/metrics/{group}", {
        params: {
          path: { group },
          query: {
            filters: queryFilters,
            cursor,
            sort: pagination.sort,
            order: pagination.direction,
            limit,
            format: "json",
          },
        },
        signal,
      }),
    );
  const query = useQuery({
    queryKey: [
      organization.id,
      "metrics",
      group,
      queryFilters,
      pagination.cursor,
      pagination.sort,
      pagination.direction,
    ],
    queryFn: ({ signal }) => fetchPage(pagination.cursor, signal),
  });
  const columns = useMemo<ColumnDef<MetricRow>[]>(
    () =>
      (
        Object.keys(
          copy.workspace.systemStatus.dimensions,
        ) as (keyof MetricRow)[]
      ).map((key) => ({
        accessorKey: key,
        header: copy.workspace.systemStatus.dimensions[key],
        enableSorting: metricSortKeys.some((value) => value === key),
        cell: ({ row }) =>
          key === "truncated_fields" ? (
            <ShortenedFields fields={row.original.truncated_fields} />
          ) : key === "metric" ? (
            copy.workspace.systemStatus.metrics[row.original.metric]
          ) : key === "value" ? (
            metricValue(row.original.value, row.original.unit)
          ) : key === "unit" ? (
            copy.workspace.systemStatus.units[row.original.unit]
          ) : key === "tools_enabled" ? (
            row.original.tools_enabled === null ? (
              copy.workspace.common.unavailable
            ) : row.original.tools_enabled ? (
              copy.workspace.systemStatus.toolsEnabled
            ) : (
              copy.workspace.systemStatus.toolsDisabled
            )
          ) : (
            textValue(row.original[key])
          ),
      })),
    [],
  );
  return (
    <>
      {query.isPending && <LoadingState />}
      {query.error ? (
        <RequestError
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
        />
      ) : (
        <>
          <MetricChart
            title={copy.workspace.systemStatus.metrics[metric]}
            rows={query.data?.items ?? []}
          />
          <p className="field-hint">{copy.workspace.systemStatus.chartPage}</p>
          <DataTable
            data={query.data?.items ?? []}
            columns={columns}
            sorting={pagination.sorting}
            onSortingChange={pagination.onSortingChange}
            loading={query.isPending}
            nextCursor={query.data?.cursor ?? null}
            pageIndex={pagination.pageIndex}
            onNext={() => {
              pagination.next(query.data?.cursor ?? null);
            }}
            onPrevious={pagination.previous}
            label={`${copy.workspace.systemStatus.groups[group]} · ${copy.workspace.systemStatus.table}`}
            csvName={`${group}-${copy.workspace.systemStatus.csvName}`}
            fetchExportPage={(cursor, signal) => fetchPage(cursor, signal, 100)}
          />
        </>
      )}
    </>
  );
}
