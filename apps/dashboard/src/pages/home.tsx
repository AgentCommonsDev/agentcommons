import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  homeSectionSchema,
  homeSectionSort,
  type HomeItem,
  type HomeSection,
} from "@agentcommons/core/schemas/home";
import type { MetricRow } from "@agentcommons/core/schemas/metrics";
import { copy } from "../copy";
import { api, unwrap } from "../lib/api/client";
import { usePagination } from "../lib/pagination";
import { dateTime, number } from "../lib/display";
import { useWorkspace } from "../components/workspace/context";
import { DataTable } from "../components/workspace/data-table";
import { reuseColumns } from "../components/workspace/reuse-columns";
import { MetricChart, metricValue } from "../components/workspace/metric-chart";
import { Button } from "../components/ui/button";
import {
  Field,
  LoadingState,
  PageHeading,
  RequestError,
  ShortenedFields,
} from "../components/workspace/primitives";

function HomeActivity({ section }: { section: HomeSection }) {
  const { organization } = useWorkspace();
  const [draft, setDraft] = useState("");
  const [filter, setFilter] = useState("");
  const gaps = section === "gap_repos" || section === "zero_results";
  const pagination = usePagination(
    homeSectionSort[section][0],
    homeSectionSort[section],
  );
  const fetchPage = async (cursor: string | null, signal: AbortSignal) =>
    unwrap(
      await api.GET("/api/v1/home/{section}", {
        params: {
          path: { section },
          query: {
            limit: 25,
            cursor,
            sort: pagination.sort,
            order: pagination.direction,
            format: "json",
            ...(filter
              ? gaps
                ? { query: filter }
                : { reader_user_id: filter }
              : {}),
          },
        },
        signal,
      }),
    );
  const query = useQuery({
    queryKey: [
      organization.id,
      "home",
      section,
      filter,
      pagination.cursor,
      pagination.sort,
      pagination.direction,
    ],
    queryFn: ({ signal }) => fetchPage(pagination.cursor, signal),
  });
  const columns: ColumnDef<HomeItem>[] =
    section === "gap_repos"
      ? [
          {
            accessorKey: "repo_name",
            header: copy.workspace.home.repo,
            cell: ({ row }) =>
              "repo_name" in row.original ? (
                <>
                  {row.original.repo_name}
                  <ShortenedFields fields={row.original.truncated_fields} />
                </>
              ) : null,
          },
          { accessorKey: "sessions", header: copy.workspace.home.sessions },
        ]
      : section === "zero_results"
        ? [
            {
              accessorKey: "searched_at",
              header: copy.workspace.home.searched,
              cell: ({ row }) =>
                "searched_at" in row.original
                  ? dateTime(row.original.searched_at)
                  : null,
            },
            {
              accessorKey: "query",
              header: copy.workspace.home.query,
              cell: ({ row }) =>
                "query" in row.original ? (
                  <>
                    {row.original.query}
                    <ShortenedFields fields={row.original.truncated_fields} />
                  </>
                ) : null,
            },
          ]
        : reuseColumns<HomeItem>((row) =>
            "source_session_id" in row ? row : null,
          );
  return (
    <>
      <form
        className="inline-admin-filter"
        onSubmit={(event) => {
          event.preventDefault();
          setFilter(draft.trim());
          pagination.reset();
        }}
      >
        <Field
          label={
            gaps
              ? copy.workspace.home.textFilter
              : copy.workspace.detail.readerUserId
          }
        >
          {(props) => (
            <input
              {...props}
              value={draft}
              maxLength={256}
              onChange={(event) => {
                setDraft(event.target.value);
              }}
            />
          )}
        </Field>
        <Button type="submit" variant="secondary">
          {copy.workspace.common.apply}
        </Button>
      </form>
      {query.error && (
        <RequestError
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
        />
      )}
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
        label={copy.workspace.home.sections[section]}
        csvName={copy.workspace.home.csvName}
        fetchExportPage={fetchPage}
      />
    </>
  );
}

export function HomePage() {
  const { organization } = useWorkspace();
  const [section, setSection] = useState<HomeSection>("reused");
  const query = useQuery({
    queryKey: [organization.id, "home", "summary"],
    queryFn: async ({ signal }) =>
      unwrap(await api.GET("/api/v1/home", { signal })),
  });
  const data = query.data;
  const current = data?.weekly.find((row) => row.week === data.week);
  return (
    <>
      <PageHeading
        title={copy.workspace.home.title}
        description={copy.workspace.home.description}
      />
      {query.isPending && <LoadingState />}
      {query.error && (
        <RequestError
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
        />
      )}
      {data && (
        <>
          <section
            className="metric-section reuse-headline"
            aria-label={copy.workspace.home.currentWeek}
          >
            <h2>{copy.workspace.home.currentWeek}</h2>
            <p>{copy.workspace.home.definition}</p>
            <dl className="reuse-values">
              {(["reuse_rate", "cross_user_reuse_rate"] as const).map(
                (metric) => (
                  <div key={metric}>
                    <dt>{copy.workspace.systemStatus.metrics[metric]}</dt>
                    <dd>{metricValue(current?.[metric] ?? null, "ratio")}</dd>
                  </div>
                ),
              )}
            </dl>
            <p>
              {data.week}
              {copy.workspace.common.separator}
              {number(current?.reuse_sessions)}
              {copy.workspace.common.fractionSeparator}
              {number(current?.sessions)}
            </p>
            <details>
              <summary>{copy.workspace.home.trend}</summary>
              {(["reuse_rate", "cross_user_reuse_rate"] as const).map(
                (metric) => {
                  const rows: MetricRow[] = data.weekly.map((row) => ({
                    metric,
                    date: row.week,
                    repo_name: null,
                    harness: null,
                    user_id: null,
                    tool: null,
                    policy_id: null,
                    tools_enabled: null,
                    value: row[metric],
                    numerator:
                      metric === "reuse_rate"
                        ? row.reuse_sessions
                        : row.cross_user_reuse_sessions,
                    denominator: row.sessions,
                    unit: "ratio",
                    truncated_fields: [],
                  }));
                  return (
                    <MetricChart
                      key={metric}
                      title={copy.workspace.systemStatus.metrics[metric]}
                      rows={rows}
                    />
                  );
                },
              )}
            </details>
          </section>
          <section
            className="metric-section"
            aria-label={copy.workspace.home.impact}
          >
            <h2>{copy.workspace.home.impact}</h2>
            <dl className="status-metrics">
              {[
                [
                  copy.workspace.home.helped,
                  data.impact.sessions_reused_by_others,
                ],
                [copy.workspace.home.readers, data.impact.distinct_readers],
                [copy.workspace.home.made, data.impact.reuses_made],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{number(typeof value === "number" ? value : null)}</dd>
                </div>
              ))}
            </dl>
          </section>
        </>
      )}
      <section
        className="metric-section"
        aria-label={copy.workspace.home.activity}
      >
        <h2>{copy.workspace.home.activity}</h2>
        <Field label={copy.workspace.home.section}>
          {(props) => (
            <select
              {...props}
              value={section}
              onChange={(event) => {
                setSection(homeSectionSchema.parse(event.target.value));
              }}
            >
              {homeSectionSchema.options.map((value) => (
                <option key={value} value={value}>
                  {copy.workspace.home.sections[value]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <p>{copy.workspace.home.hints[section]}</p>
        <HomeActivity key={`${organization.id}-${section}`} section={section} />
      </section>
    </>
  );
}
