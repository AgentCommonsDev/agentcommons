import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import type { z } from "zod";
import type * as schemas from "@agentcommons/core/schemas";
import { X } from "lucide-react";
import { copy } from "../../copy";
import { api, unwrap } from "../../lib/api/client";
import {
  redactionHitSortKeys,
  redactionRunSessionSortKeys,
  redactionRunSortKeys,
} from "../../lib/api/options";
import { counted, dateTime, number } from "../../lib/display";
import { useWorkspace } from "../../components/app/workspace";
import { DataTable } from "../../components/app/data-table";
import { Disclosure, Stat, StatGrid } from "../../components/app/display";
import { QueryState, StatusBadge } from "../../components/app/states";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { EnumFilterSelect, FilterBar, countActive } from "./filters";
import { useListPage } from "./list";

type Run = z.infer<typeof schemas.redactionRunSchema>;
type RunSession = z.infer<typeof schemas.redactionRunSessionSchema>;
type Hit = z.infer<typeof schemas.redactionHitSchema>;
type Source = Hit["source"];
type PolicyHits = z.infer<
  typeof schemas.redactionSummaryOutputSchema
>["by_policy"][number];
const text = copy.admin.redactionActivity;
const sources: readonly Source[] = ["capture", "rescan"];
/** While a rescan the page is watching runs, its ledger refreshes on this interval. */
const LIVE_INTERVAL_MS = 5000;
const linkClass = "font-mono text-xs text-accent hover:underline";

/** The whole id: time-ordered ids share their leading characters, so a prefix would not tell sessions apart. */
function SessionLink({ id }: { id: string }) {
  return (
    <Link
      to="/app/sessions/$id"
      params={{ id }}
      className={`${linkClass} break-all`}
      aria-label={`${text.openSession} ${id}`}
    >
      {id}
    </Link>
  );
}
/** The message a hit landed on, as the deep link the session page selects; metadata has no message. */
function MessageLink({ hit }: { hit: Hit }) {
  if (hit.seq === null)
    return <span className="text-muted">{text.metadata}</span>;
  return (
    <Link
      to="/app/sessions/$id"
      params={{ id: hit.session_id }}
      hash={String(hit.seq)}
      className={linkClass}
    >
      {text.message(hit.seq)}
    </Link>
  );
}
function SourceBadge({ source }: { source: Source }) {
  return (
    <Badge variant={source === "rescan" ? "accent" : "neutral"}>
      {text.sources[source]}
    </Badge>
  );
}

const policyColumns: ColumnDef<PolicyHits>[] = [
  {
    accessorKey: "name",
    header: text.policy,
    size: 200,
    cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
  },
  {
    accessorKey: "kind",
    header: text.kind,
    size: 110,
    cell: ({ row }) => <StatusBadge value={row.original.kind} />,
  },
  {
    accessorKey: "count",
    header: text.redactions,
    size: 110,
    cell: ({ row }) => number(row.original.count),
  },
  {
    accessorKey: "sessions",
    header: text.sessions,
    size: 100,
    cell: ({ row }) => number(row.original.sessions),
  },
];
/** Totals, recent windows, the run tally and the per-policy table from one summary read. */
export function RedactionSummary({ live }: { live: boolean }) {
  const { organization } = useWorkspace();
  const query = useQuery({
    queryKey: [organization.id, "admin", "redaction", "summary"],
    queryFn: async ({ signal }) =>
      unwrap(await api.GET("/api/v1/admin/redaction/summary", { signal })),
    ...(live ? { refetchInterval: LIVE_INTERVAL_MS } : {}),
  });
  return (
    <section
      className="flex flex-col gap-3"
      aria-label={text.title}
      data-testid="admin-redaction-summary"
    >
      <div>
        <h2 className="text-[15px] leading-tight font-semibold">
          {text.title}
        </h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">
          {text.description}
        </p>
      </div>
      <QueryState query={query} rows={2}>
        {(data) => (
          <>
            <StatGrid>
              <Stat
                label={text.total}
                value={number(data.total)}
                hint={counted(data.sessions, text.sessionOne, text.sessionMany)}
              />
              <Stat
                label={text.last7}
                value={number(data.last_7_days.total)}
                hint={text.windowHint(
                  number(data.last_7_days.capture),
                  number(data.last_7_days.rescan),
                )}
              />
              <Stat
                label={text.last30}
                value={number(data.last_30_days.total)}
                hint={text.windowHint(
                  number(data.last_30_days.capture),
                  number(data.last_30_days.rescan),
                )}
              />
              <Stat
                label={text.runs}
                value={number(data.runs.total)}
                hint={text.runsHint(
                  number(data.runs.active),
                  number(data.runs.failed),
                )}
              />
            </StatGrid>
            <Card>
              <CardHeader>
                <div className="min-w-0">
                  <CardTitle>{text.byPolicy}</CardTitle>
                  <CardDescription>{text.byPolicyDescription}</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <div data-testid="admin-redaction-by-policy">
                  <DataTable
                    data={data.by_policy.filter((policy) => policy.count > 0)}
                    columns={policyColumns}
                    label={text.byPolicy}
                    rowId={(row) => row.policy_id}
                    compact
                    emptyTitle={text.noPolicyHits}
                    emptyDescription={text.noPolicyHitsHint}
                  />
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </QueryState>
    </section>
  );
}

/** The hits one run applied to one session, each linking to its message. */
function SessionHits({
  runId,
  sessionId,
}: {
  runId: string;
  sessionId: string;
}) {
  const { organization } = useWorkspace();
  const query = useQuery({
    queryKey: [organization.id, "admin", "redaction", "hits", runId, sessionId],
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET("/api/v1/admin/redaction/hits", {
          params: {
            query: {
              filters: { run_id: runId, session_id: sessionId },
              sort: "seq",
              order: "asc",
              limit: 100,
              format: "json",
            },
          },
          signal,
        }),
      ),
  });
  return (
    <QueryState query={query} rows={2}>
      {(page) =>
        page.items.length === 0 ? (
          <p className="text-sm text-muted">{text.noHits}</p>
        ) : (
          <ul className="flex flex-col gap-1.5 text-sm">
            {page.items.map((hit) => (
              <li key={hit.id} className="flex flex-wrap items-center gap-2">
                <MessageLink hit={hit} />
                <Badge variant="accent">
                  {hit.policy_name ?? copy.app.common.unavailable}
                </Badge>
                <span className="tabular-nums text-muted">
                  {number(hit.count)}
                </span>
                <span className="text-xs text-subtle">
                  {dateTime(hit.redacted_at)}
                </span>
              </li>
            ))}
          </ul>
        )
      }
    </QueryState>
  );
}
/** The sessions one run changed, each with its page link and the messages it redacted. */
function RunSessions({ run, onClose }: { run: Run; onClose: () => void }) {
  const { organization } = useWorkspace();
  const list = useListPage<
    RunSession,
    (typeof redactionRunSessionSortKeys)[number]
  >({
    queryKey: [organization.id, "admin", "redaction", "runs", run.id],
    initialSort: "redaction_count",
    sortKeys: redactionRunSessionSortKeys,
    csvName: text.csvRunSessions,
    fetchPage: async ({ cursor, sort, order, limit }, signal) =>
      unwrap(
        await api.GET("/api/v1/admin/redaction/rescan/{id}/sessions", {
          params: {
            path: { id: run.id },
            query: { cursor, sort, order, limit, format: "json" },
          },
          signal,
        }),
      ),
  });
  const columns: ColumnDef<RunSession>[] = [
    {
      accessorKey: "session_id",
      header: text.session,
      enableSorting: false,
      size: 220,
      cell: ({ row }) => <SessionLink id={row.original.session_id} />,
    },
    {
      accessorKey: "redaction_count",
      header: text.redactions,
      size: 100,
      cell: ({ row }) => number(row.original.redaction_count),
    },
    {
      accessorKey: "processed_at",
      header: text.processedAt,
      size: 140,
      cell: ({ row }) => dateTime(row.original.processed_at),
    },
    {
      id: "messages",
      header: text.messages,
      enableSorting: false,
      size: 260,
      cell: ({ row }) => (
        <Disclosure showLabel={text.showMessages} hideLabel={text.hideMessages}>
          <SessionHits runId={run.id} sessionId={row.original.session_id} />
        </Disclosure>
      ),
    },
  ];
  return (
    <div
      className="flex flex-col gap-3 border-t border-line pt-4"
      data-testid="admin-redaction-run-sessions"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">
            {text.runDetails(dateTime(run.created_at))}
          </h3>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">
            {text.runDetailsHint}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          aria-label={copy.app.common.close}
        >
          <X aria-hidden />
        </Button>
      </div>
      <DataTable
        {...list.table}
        columns={columns}
        label={text.runDetails(dateTime(run.created_at))}
        rowId={(row) => row.session_id}
        compact
        emptyTitle={text.noChanges}
        emptyDescription={text.noChangesHint}
      />
    </div>
  );
}
/** Every rescan run; selecting one lists the sessions it changed below the table. */
export function RescanRuns({ live }: { live: boolean }) {
  const { organization } = useWorkspace();
  const [selected, setSelected] = useState<Run | null>(null);
  const list = useListPage<Run, (typeof redactionRunSortKeys)[number]>({
    queryKey: [organization.id, "admin", "redaction", "runs"],
    initialSort: "created_at",
    sortKeys: redactionRunSortKeys,
    csvName: text.csvRuns,
    fetchPage: async ({ cursor, sort, order, limit }, signal) =>
      unwrap(
        await api.GET("/api/v1/admin/redaction/rescan", {
          params: { query: { cursor, sort, order, limit, format: "json" } },
          signal,
        }),
      ),
    ...(live ? { refetchInterval: LIVE_INTERVAL_MS } : {}),
  });
  const columns: ColumnDef<Run>[] = [
    {
      accessorKey: "created_at",
      header: text.started,
      size: 140,
      cell: ({ row }) => dateTime(row.original.created_at),
    },
    {
      accessorKey: "state",
      header: text.state,
      size: 100,
      cell: ({ row }) => <StatusBadge value={row.original.state} />,
    },
    {
      accessorKey: "total_sessions",
      header: text.processed,
      size: 110,
      cell: ({ row }) =>
        `${number(row.original.processed_sessions)}${copy.app.common.fractionSeparator}${number(row.original.total_sessions)}`,
    },
    {
      id: "changed_sessions",
      accessorFn: (run) => run.changed_sessions,
      header: text.changed,
      enableSorting: false,
      size: 110,
      cell: ({ row }) => number(row.original.changed_sessions),
    },
    {
      accessorKey: "redaction_count",
      header: text.redactions,
      size: 100,
      cell: ({ row }) => number(row.original.redaction_count),
    },
    {
      accessorKey: "error",
      header: text.error,
      enableSorting: false,
      size: 200,
      cell: ({ row }) => row.original.error ?? copy.app.common.unavailable,
    },
  ];
  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>{text.rescans}</CardTitle>
          <CardDescription>{text.rescansDescription}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div data-testid="admin-redaction-runs">
          <DataTable
            {...list.table}
            columns={columns}
            label={text.rescans}
            hiddenColumns={["error"]}
            rowId={(row) => row.id}
            onRowClick={(run) => {
              setSelected((current) => (current?.id === run.id ? null : run));
            }}
            emptyTitle={text.noRuns}
            emptyDescription={text.noRunsHint}
          />
        </div>
        {selected && (
          <RunSessions
            key={selected.id}
            run={selected}
            onClose={() => {
              setSelected(null);
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}

type HitFilters = { source?: Source };
/** Every redaction newest first, with the session and message it landed on. */
export function RecentRedactions({ live }: { live: boolean }) {
  const { organization } = useWorkspace();
  const list = useListPage<
    Hit,
    (typeof redactionHitSortKeys)[number],
    HitFilters
  >({
    queryKey: [organization.id, "admin", "redaction", "hits"],
    initialSort: "redacted_at",
    sortKeys: redactionHitSortKeys,
    csvName: text.csvHits,
    fetchPage: async (request, signal) =>
      unwrap(
        await api.GET("/api/v1/admin/redaction/hits", {
          params: { query: { ...request, format: "json" } },
          signal,
        }),
      ),
    ...(live ? { refetchInterval: LIVE_INTERVAL_MS } : {}),
  });
  const columns: ColumnDef<Hit>[] = [
    {
      accessorKey: "redacted_at",
      header: text.time,
      size: 140,
      cell: ({ row }) => dateTime(row.original.redacted_at),
    },
    {
      accessorKey: "session_id",
      header: text.session,
      enableSorting: false,
      size: 220,
      cell: ({ row }) => <SessionLink id={row.original.session_id} />,
    },
    {
      accessorKey: "seq",
      header: text.messageColumn,
      size: 120,
      cell: ({ row }) => <MessageLink hit={row.original} />,
    },
    {
      accessorKey: "policy_name",
      header: text.policy,
      enableSorting: false,
      size: 150,
      cell: ({ row }) =>
        row.original.policy_name ?? copy.app.common.unavailable,
    },
    {
      accessorKey: "source",
      header: text.source,
      enableSorting: false,
      size: 90,
      cell: ({ row }) => <SourceBadge source={row.original.source} />,
    },
    {
      accessorKey: "count",
      header: text.count,
      size: 80,
      cell: ({ row }) => number(row.original.count),
    },
  ];
  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>{text.recent}</CardTitle>
          <CardDescription>{text.recentDescription}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <div data-testid="admin-redaction-hits">
          <DataTable
            {...list.table}
            columns={columns}
            label={text.recent}
            rowId={(row) => row.id}
            emptyTitle={text.noHits}
            emptyDescription={text.noHitsHint}
            toolbar={
              <FilterBar
                label={copy.app.common.filters}
                activeCount={countActive(list.filters)}
                onApply={() => {
                  list.setFilters(list.filters);
                }}
                onClear={() => {
                  list.setFilters({});
                }}
                controls={[
                  {
                    id: "source",
                    label: text.source,
                    width: "sm:w-40",
                    render: (props) => (
                      <EnumFilterSelect
                        {...props}
                        value={list.filters.source}
                        options={sources}
                        optionLabel={(value) => text.sources[value]}
                        allLabel={text.allSources}
                        onChange={(next) => {
                          list.setFilter("source", next);
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
    </Card>
  );
}
