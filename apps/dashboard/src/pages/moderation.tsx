import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { searchFiltersSchema } from "@agentcommons/core/schemas/search";
import { copy } from "../copy";
import { api, unwrap, defined } from "../lib/api/client";
import { sessionSortKeys } from "../lib/api/options";
import { usePagination } from "../lib/pagination";
import type { SessionItem } from "../lib/types";
import { useWorkspace } from "../components/workspace/context";
import { DataTable } from "../components/workspace/data-table";
import { ConfirmAction } from "../components/workspace/confirm-action";
import {
  PageHeading,
  RequestError,
  StatusBadge,
} from "../components/workspace/primitives";
import { Button } from "../components/ui/button";
import { FilterChips, sessionColumns } from "./sessions";
export function ModerationPage() {
  const { organization } = useWorkspace();
  const client = useQueryClient();
  const pagination = usePagination("started_at", sessionSortKeys);
  const [filters, setFilters] = useState<Record<string, string | string[]>>({});
  const [action, setAction] = useState<
    | { id: string; visibility: "PUBLIC" | "PRIVATE" }
    | { id: string; purge: true }
    | null
  >(null);
  const query = useQuery({
    queryKey: [
      organization.id,
      "moderation",
      filters,
      pagination.cursor,
      pagination.sort,
      pagination.direction,
    ],
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET("/api/v1/sessions", {
          params: {
            query: {
              filters: defined(searchFiltersSchema.parse(filters)),
              cursor: pagination.cursor,
              sort: pagination.sort,
              order: pagination.direction,
              limit: 50,
              format: "json",
            },
          },
          signal,
        }),
      ),
  });
  const columns = useMemo<ColumnDef<SessionItem>[]>(
    () => [
      ...sessionColumns(),
      {
        accessorKey: "visibility",
        header: copy.workspace.fields.visibility,
        enableSorting: false,
        cell: ({ row }) => <StatusBadge value={row.original.visibility} />,
      },
      {
        id: "actions",
        header: copy.workspace.common.actions,
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <div className="table-row-actions">
            <Button
              size="small"
              variant="ghost"
              disabled={row.original.visibility === "PUBLIC"}
              onClick={() => {
                setAction({
                  id: row.original.session_id,
                  visibility: "PUBLIC",
                });
              }}
            >
              {copy.workspace.moderation.visible}
            </Button>
            <Button
              size="small"
              variant="ghost"
              disabled={row.original.visibility === "PRIVATE"}
              onClick={() => {
                setAction({
                  id: row.original.session_id,
                  visibility: "PRIVATE",
                });
              }}
            >
              {copy.workspace.moderation.private}
            </Button>
            <Button
              size="small"
              variant="ghost"
              onClick={() => {
                setAction({ id: row.original.session_id, purge: true });
              }}
            >
              {copy.workspace.moderation.purge}
            </Button>
          </div>
        ),
      },
    ],
    [],
  );
  const purge = action !== null && "purge" in action;
  return (
    <>
      <PageHeading
        title={copy.workspace.moderation.title}
        description={copy.workspace.moderation.description}
      />
      <FilterChips
        filters={filters}
        onChange={(next) => {
          setFilters(next);
          pagination.reset();
        }}
      />
      {query.error && (
        <RequestError
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
        />
      )}
      {!query.error && (
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
          label={copy.workspace.moderation.title}
          csvName={copy.workspace.moderation.csvName}
          fetchExportPage={async (cursor, signal) =>
            unwrap(
              await api.GET("/api/v1/sessions", {
                params: {
                  query: {
                    filters: defined(searchFiltersSchema.parse(filters)),
                    cursor,
                    sort: pagination.sort,
                    order: pagination.direction,
                    limit: 100,
                    format: "json",
                  },
                },
                signal,
              }),
            )
          }
        />
      )}
      <ConfirmAction
        open={action !== null}
        onOpenChange={(open) => {
          if (!open) setAction(null);
        }}
        title={
          purge
            ? copy.workspace.moderation.purgeTitle
            : copy.workspace.moderation.visibilityTitle
        }
        description={
          purge
            ? copy.workspace.moderation.purgeDescription
            : copy.workspace.moderation.visibilityDescription
        }
        confirmLabel={
          purge ? copy.workspace.moderation.purge : copy.workspace.common.save
        }
        action={async (reason) => {
          if (!action) return;
          const params = { path: { id: action.id } };
          if ("purge" in action)
            unwrap(
              await api.POST("/api/v1/admin/sessions/{id}/purge", {
                params,
                body: { reason },
              }),
            );
          else
            unwrap(
              await api.POST("/api/v1/admin/sessions/{id}/visibility", {
                params,
                body: { visibility: action.visibility, reason },
              }),
            );
          await client.invalidateQueries({ queryKey: [organization.id] });
        }}
      />
    </>
  );
}
