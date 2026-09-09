import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { copy } from "../../copy";
import { api, unwrap } from "../../lib/api/client";
import { sessionSortKeys } from "../../lib/api/options";
import {
  dateTime,
  duration,
  harnessLabel,
  number,
  relativeTime,
  textValue,
} from "../../lib/display";
import { usePagination } from "../../lib/pagination";
import { paths } from "../../lib/routes";
import type { SessionItem } from "../../lib/types";
import { useWorkspace } from "../../components/app/workspace";
import { DataTable } from "../../components/app/data-table";
import { RequestError } from "../../components/app/states";
import { Button } from "../../components/ui/button";
import type { ApiFilters } from "./search-state";
import { SessionStatusBadge } from "./session-header";

const fields = copy.app.fields;
/** Every R-DASH-11 column plus the subagent count; ids double as server sort keys. */
function sessionColumns(): ColumnDef<SessionItem>[] {
  return [
    {
      accessorKey: "title",
      header: fields.title,
      cell: ({ row }) => (
        <Link
          to="/app/sessions/$id"
          params={{ id: row.original.session_id }}
          className="line-clamp-2 font-medium text-fg hover:underline"
        >
          {row.original.title ?? copy.sessions.list.untitled}
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
      cell: ({ row }) => (
        <span className="whitespace-nowrap">
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
      cell: ({ getValue }) => (
        <span className="font-mono text-xs">{textValue(getValue())}</span>
      ),
    },
    {
      id: "repo_name",
      accessorFn: (row) =>
        [row.repo_name, row.branch].filter(Boolean).join(" @ "),
      header: copy.sessions.list.repoBranch,
      cell: ({ row }) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate">{textValue(row.original.repo_name)}</span>
          {row.original.branch && (
            <span className="truncate font-mono text-xs text-muted">
              {row.original.branch}
            </span>
          )}
        </span>
      ),
    },
    {
      accessorKey: "user_email",
      header: fields.user_email,
      cell: ({ getValue }) => (
        <span className="truncate">{textValue(getValue())}</span>
      ),
    },
    {
      accessorKey: "installation_hostname",
      header: fields.installation_hostname,
      cell: ({ getValue }) => textValue(getValue()),
    },
    {
      accessorKey: "started_at",
      header: fields.started_at,
      cell: ({ row }) => (
        <time
          dateTime={row.original.started_at}
          title={dateTime(row.original.started_at)}
          className="whitespace-nowrap"
        >
          {relativeTime(row.original.started_at)}
        </time>
      ),
    },
    {
      accessorKey: "duration_seconds",
      header: copy.sessions.list.duration,
      cell: ({ row }) => (
        <span className="whitespace-nowrap tabular-nums">
          {duration(row.original.duration_seconds)}
        </span>
      ),
    },
    {
      accessorKey: "message_count",
      header: fields.message_count,
      cell: ({ getValue }) => (
        <span className="tabular-nums">{number(getValue<number>())}</span>
      ),
    },
    {
      accessorKey: "tool_call_count",
      header: fields.tool_call_count,
      cell: ({ getValue }) => (
        <span className="tabular-nums">{number(getValue<number>())}</span>
      ),
    },
    {
      accessorKey: "observed_commit_count",
      header: fields.observed_commit_count,
      cell: ({ getValue }) => (
        <span className="tabular-nums">{number(getValue<number>())}</span>
      ),
    },
    {
      accessorKey: "reuse_count",
      header: fields.reuse_count,
      cell: ({ getValue }) => (
        <span className="tabular-nums">{number(getValue<number>())}</span>
      ),
    },
    {
      accessorKey: "status",
      header: fields.status,
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
      cell: ({ getValue }) => (
        <span className="tabular-nums">{number(getValue<number>())}</span>
      ),
    },
  ];
}
const hiddenColumns = [
  "harness",
  "model",
  "installation_hostname",
  "message_count",
  "tool_call_count",
  "observed_commit_count",
  "child_count",
] as const;

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
  if (list.error)
    return (
      <RequestError
        error={list.error}
        retry={() => {
          void list.refetch();
        }}
      />
    );
  return (
    <div data-testid="sessions-table">
      <DataTable
        data={list.data?.items ?? []}
        columns={columns}
        sorting={pagination.sorting}
        onSortingChange={pagination.onSortingChange}
        loading={list.isPending}
        page={{
          index: pagination.pageIndex,
          hasNext:
            list.data?.cursor !== null && list.data?.cursor !== undefined,
          onNext: () => {
            pagination.next(list.data?.cursor ?? null);
          },
          onPrevious: pagination.previous,
        }}
        label={copy.sessions.list.label}
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
