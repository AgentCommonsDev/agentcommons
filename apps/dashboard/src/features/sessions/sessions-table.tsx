import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { copy } from "../../copy";
import { api, unwrap } from "../../lib/api/client";
import { sessionSortKeys } from "../../lib/api/options";
import {
  counted,
  dateTime,
  duration,
  harnessLabel,
  number,
  relativeTime,
  textValue,
} from "../../lib/display";
import { usePagination } from "../../lib/pagination";
import { paths } from "../../lib/routes";
import type { SessionItem, SessionsTotal } from "../../lib/types";
import { useWorkspace } from "../../components/app/workspace";
import { DataTable } from "../../components/app/data-table";
import { Button } from "../../components/ui/button";
import { Skeleton } from "../../components/ui/feedback";
import type { ApiFilters } from "./search-state";
import { SessionStatusBadge } from "./session-header";

const fields = copy.app.fields;
/** Counts and durations sit flush right so their digits line up down the column. */
const numeric = { meta: { align: "end" } } as const;
/** Every R-DASH-11 column plus the subagent count; ids double as server sort keys. */
function sessionColumns(): ColumnDef<SessionItem>[] {
  return [
    {
      accessorKey: "title",
      header: fields.title,
      size: 240,
      cell: ({ row }) => (
        <Link
          to="/app/sessions/$id"
          params={{ id: row.original.session_id }}
          className="line-clamp-2 font-medium text-fg hover:underline"
        >
          {row.original.title ?? copy.app.common.untitledSession}
        </Link>
      ),
    },
    {
      id: "harness",
      accessorFn: (row) =>
        [harnessLabel(row.harness), row.harness_version]
          .filter(Boolean)
          .join(" "),
      header: fields.harness,
      size: 110,
      cell: ({ row }) => (
        <span>
          {harnessLabel(row.original.harness)}
          {row.original.harness_version && (
            <span className="ml-1 text-muted">
              {row.original.harness_version}
            </span>
          )}
        </span>
      ),
    },
    {
      accessorKey: "model",
      header: fields.model,
      size: 130,
      cell: ({ getValue }) => (
        <span className="font-mono text-xs">{textValue(getValue())}</span>
      ),
    },
    {
      id: "repo_name",
      accessorFn: (row) =>
        [row.repo_name, row.branch].filter(Boolean).join(" @ "),
      header: copy.sessions.list.repoBranch,
      size: 180,
      cell: ({ row }) => (
        <span className="flex min-w-0 flex-col">
          <span
            className="truncate"
            title={row.original.repo_name ?? undefined}
          >
            {textValue(row.original.repo_name)}
          </span>
          {row.original.branch && (
            <span
              className="truncate font-mono text-xs text-muted"
              title={row.original.branch}
            >
              {row.original.branch}
            </span>
          )}
        </span>
      ),
    },
    {
      accessorKey: "user_email",
      header: fields.user_email,
      size: 170,
      cell: ({ getValue }) => textValue(getValue()),
    },
    {
      accessorKey: "installation_hostname",
      header: fields.installation_hostname,
      size: 140,
      cell: ({ getValue }) => textValue(getValue()),
    },
    {
      accessorKey: "started_at",
      header: fields.started_at,
      size: 100,
      cell: ({ row }) => (
        <time
          dateTime={row.original.started_at}
          title={dateTime(row.original.started_at)}
        >
          {relativeTime(row.original.started_at)}
        </time>
      ),
    },
    {
      accessorKey: "duration_seconds",
      header: copy.sessions.list.duration,
      size: 80,
      ...numeric,
      cell: ({ row }) => (
        <span className="tabular-nums">
          {duration(row.original.duration_seconds)}
        </span>
      ),
    },
    {
      accessorKey: "message_count",
      header: fields.message_count,
      size: 80,
      ...numeric,
      cell: ({ getValue }) => (
        <span className="tabular-nums">{number(getValue<number>())}</span>
      ),
    },
    {
      accessorKey: "tool_call_count",
      header: fields.tool_call_count,
      size: 80,
      ...numeric,
      cell: ({ getValue }) => (
        <span className="tabular-nums">{number(getValue<number>())}</span>
      ),
    },
    {
      accessorKey: "observed_commit_count",
      header: fields.observed_commit_count,
      size: 80,
      ...numeric,
      cell: ({ getValue }) => (
        <span className="tabular-nums">{number(getValue<number>())}</span>
      ),
    },
    {
      accessorKey: "reuse_count",
      header: fields.reuse_count,
      size: 110,
      ...numeric,
      cell: ({ getValue }) => (
        <span className="tabular-nums">{number(getValue<number>())}</span>
      ),
    },
    {
      accessorKey: "status",
      header: fields.status,
      size: 130,
      cell: ({ row }) => (
        <SessionStatusBadge
          status={row.original.status}
          purged={row.original.purged_at !== null}
        />
      ),
    },
    {
      accessorKey: "child_count",
      header: copy.sessions.list.subagentCount,
      enableSorting: false,
      size: 80,
      ...numeric,
      cell: ({ getValue }) => (
        <span className="tabular-nums">{number(getValue<number>())}</span>
      ),
    },
  ];
}
/**
 * The six-column default (title, repository, user, started, messages, status) fits a
 * 1024 px desktop beside the sidebar; the chooser adds the rest. Messages holds the
 * default slot over the reuse count because it is the size of the session at a glance.
 */
const hiddenColumns = [
  "harness",
  "model",
  "installation_hostname",
  "duration_seconds",
  "tool_call_count",
  "observed_commit_count",
  "reuse_count",
  "child_count",
] as const;

/**
 * "128 sessions · 4,210 messages" over every root session the filters match, from the
 * page response itself so the counts always belong to the query the rows came from; a
 * pending query shows a placeholder, never the previous query's numbers.
 */
function ListTotal({
  total,
  pending,
}: {
  total: SessionsTotal | undefined;
  pending: boolean;
}) {
  const labels = copy.sessions.list.total;
  if (pending) return <Skeleton className="h-4 w-44" />;
  if (!total) return null;
  return (
    <p data-testid="sessions-total" className="text-sm text-muted tabular-nums">
      {counted(total.sessions, labels.sessionOne, labels.sessions)}
      {copy.app.common.separator}
      {counted(total.messages, labels.messageOne, labels.messages)}
    </p>
  );
}

/** Root sessions only: subagent, fork and spawned runs appear inside their parent's page. */
export function SessionsTable({
  filters,
  filtered,
}: {
  filters: ApiFilters;
  /** Whether the reader narrowed the list; picks the empty state wording. */
  filtered: boolean;
}) {
  const { organization } = useWorkspace();
  const navigate = useNavigate();
  const pagination = usePagination("started_at", sessionSortKeys);
  const columns = useMemo(sessionColumns, []);
  const fetchPage = async (
    cursor: string | null,
    limit: number,
    signal: AbortSignal,
  ) =>
    unwrap(
      await api.GET("/api/v1/sessions", {
        params: {
          query: {
            filters,
            roots_only: true,
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
  const list = useQuery({
    queryKey: [
      organization.id,
      "sessions",
      filters,
      pagination.cursor,
      pagination.sort,
      pagination.direction,
    ],
    queryFn: ({ signal }) => fetchPage(pagination.cursor, 50, signal),
  });
  return (
    <div data-testid="sessions-table">
      <DataTable
        data={list.data?.items ?? []}
        columns={columns}
        sorting={pagination.sorting}
        onSortingChange={pagination.onSortingChange}
        loading={list.isPending}
        error={list.error}
        retry={() => {
          void list.refetch();
        }}
        page={pagination.page(list.data?.cursor)}
        label={copy.sessions.list.label}
        toolbar={
          <ListTotal total={list.data?.total} pending={list.isPending} />
        }
        csv={{
          name: copy.sessions.list.csvName,
          fetchAll: (cursor, signal) => fetchPage(cursor, 100, signal),
        }}
        hiddenColumns={hiddenColumns}
        rowId={(row) => row.session_id}
        onRowClick={(row) => {
          void navigate({
            to: "/app/sessions/$id",
            params: { id: row.session_id },
          });
        }}
        emptyTitle={
          filtered ? copy.sessions.list.noMatch : copy.sessions.list.empty
        }
        emptyDescription={
          filtered
            ? copy.sessions.list.noMatchHint
            : copy.sessions.list.emptyHint
        }
        emptyAction={
          filtered ? undefined : (
            <Button asChild variant="secondary" size="sm">
              <a href={paths.install}>{copy.sessions.list.install}</a>
            </Button>
          )
        }
      />
    </div>
  );
}
