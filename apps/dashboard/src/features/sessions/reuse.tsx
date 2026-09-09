import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import type { z } from "zod";
import {
  reuseSortKeys,
  type reuseEdgeSchema,
} from "@agentcommons/core/schemas/rest";
import { copy } from "../../copy";
import { api, unwrap } from "../../lib/api/client";
import { dateTime, harnessLabel, relativeTime } from "../../lib/display";
import { usePagination } from "../../lib/pagination";
import { useFeature } from "../../lib/use-auth-config";
import { useWorkspace } from "../../components/app/workspace";
import { DataTable } from "../../components/app/data-table";
import { QueryState, StatusBadge } from "../../components/app/states";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { EmptyState } from "../../components/ui/feedback";

type ReuseEdge = z.infer<typeof reuseEdgeSchema>;
const labels = copy.sessions.detail.reuse;
/** "Reused by" shows the reading session; "Reused from" shows the session that was read. */
function reuseColumns(direction: "by" | "from"): ColumnDef<ReuseEdge>[] {
  const peer = direction === "by" ? "source" : "target";
  return [
    {
      id: `${peer}_title`,
      accessorFn: (row) => row[`${peer}_title`],
      header: labels.session,
      enableHiding: false,
      cell: ({ row }) => (
        <Link
          to="/app/sessions/$id"
          params={{ id: row.original[`${peer}_session_id`] }}
          className="line-clamp-2 font-medium text-fg hover:underline"
        >
          {row.original[`${peer}_title`] ?? copy.app.common.untitledSession}
        </Link>
      ),
    },
    {
      accessorKey: "reader_email",
      header: labels.reader,
      enableHiding: false,
      cell: ({ row }) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate">{row.original.reader_email}</span>
          <span className="text-xs text-muted">
            {harnessLabel(row.original.reader_harness)}
          </span>
        </span>
      ),
    },
    {
      accessorKey: "read_at",
      header: labels.when,
      enableHiding: false,
      cell: ({ row }) => (
        <time
          dateTime={row.original.read_at}
          title={dateTime(row.original.read_at)}
          className="whitespace-nowrap"
        >
          {relativeTime(row.original.read_at)}
        </time>
      ),
    },
  ];
}
function ReuseTable({
  sessionId,
  direction,
}: {
  sessionId: string;
  direction: "by" | "from";
}) {
  const { organization } = useWorkspace();
  const pagination = usePagination("read_at", reuseSortKeys);
  const columns = useMemo(() => reuseColumns(direction), [direction]);
  const fetchPage = async (
    cursor: string | null,
    limit: number,
    signal: AbortSignal,
  ) =>
    unwrap(
      await api.GET("/api/v1/sessions/{id}/reuse", {
        params: {
          path: { id: sessionId },
          query: {
            direction,
            cursor,
            limit,
            sort: pagination.sort,
            order: pagination.direction,
            format: "json",
          },
        },
        signal,
      }),
    );
  const query = useQuery({
    queryKey: [
      organization.id,
      "session-reuse",
      sessionId,
      direction,
      pagination.cursor,
      pagination.sort,
      pagination.direction,
    ],
    queryFn: ({ signal }) => fetchPage(pagination.cursor, 5, signal),
  });
  const title = direction === "by" ? labels.by : labels.from;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h3 className="text-[13px] font-medium text-muted">{title}</h3>
      <DataTable
        compact
        data={query.data?.items ?? []}
        columns={columns}
        sorting={pagination.sorting}
        onSortingChange={pagination.onSortingChange}
        loading={query.isPending}
        error={query.error}
        retry={() => {
          void query.refetch();
        }}
        page={pagination.page(query.data?.cursor)}
        label={title}
        {...(query.data?.cursor
          ? {
              csv: {
                name: direction === "by" ? labels.csvBy : labels.csvFrom,
                fetchAll: (cursor: string | null, signal: AbortSignal) =>
                  fetchPage(cursor, 100, signal),
              },
            }
          : {})}
        rowId={(row) => `${row.source_session_id}:${row.target_session_id}`}
        emptyTitle={direction === "by" ? labels.emptyBy : labels.emptyFrom}
        emptyDescription=""
      />
    </div>
  );
}
function SimilarSessions({ sessionId }: { sessionId: string }) {
  const { organization } = useWorkspace();
  const similar = copy.sessions.detail.similar;
  const query = useQuery({
    queryKey: [organization.id, "similar", sessionId],
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET("/api/v1/sessions/{id}/similar", {
          params: { path: { id: sessionId }, query: { max_rows: 5 } },
          signal,
        }),
      ),
  });
  return (
    <Card>
      <CardHeader className="pb-2">
        <div>
          <CardTitle>{similar.title}</CardTitle>
          <CardDescription>{similar.description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-2">
        <QueryState query={query} rows={2}>
          {(data) =>
            data.sessions.length === 0 ? (
              <EmptyState
                compact
                title={similar.empty}
                description={similar.emptyHint}
              />
            ) : (
              <ul className="divide-y divide-line-soft rounded-lg border border-line bg-surface">
                {data.sessions.map((session) => (
                  <li
                    key={session.session_id}
                    className="flex flex-col gap-0.5 px-3 py-2"
                  >
                    <Link
                      to="/app/sessions/$id"
                      params={{ id: session.session_id }}
                      className="line-clamp-2 text-sm font-medium hover:underline"
                    >
                      {session.title ?? copy.app.common.untitledSession}
                    </Link>
                    <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                      <StatusBadge value={session.status} />
                      <span>{harnessLabel(session.harness)}</span>
                      {session.repo_name && (
                        <span className="truncate">{session.repo_name}</span>
                      )}
                      <time dateTime={session.started_at}>
                        {relativeTime(session.started_at)}
                      </time>
                    </span>
                  </li>
                ))}
              </ul>
            )
          }
        </QueryState>
      </CardContent>
    </Card>
  );
}
/** Reuse edges in one card; similarity, a different concept, gets its own card below. */
export function ReuseCard({ sessionId }: { sessionId: string }) {
  const similar = useFeature("similar_sessions");
  return (
    <>
      <Card>
        <CardHeader className="pb-2">
          <div>
            <CardTitle>{labels.title}</CardTitle>
            <CardDescription>{labels.description}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-5 lg:grid-cols-2">
          <ReuseTable sessionId={sessionId} direction="by" />
          <ReuseTable sessionId={sessionId} direction="from" />
        </CardContent>
      </Card>
      {similar && <SimilarSessions sessionId={sessionId} />}
    </>
  );
}
