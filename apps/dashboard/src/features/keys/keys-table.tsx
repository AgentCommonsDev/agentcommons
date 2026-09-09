import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { ConfirmDialog } from "../../components/app/confirm-dialog";
import { DataTable } from "../../components/app/data-table";
import { CopyButton, RequestError } from "../../components/app/states";
import { useWorkspace } from "../../components/app/workspace";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { copy } from "../../copy";
import { keySortKeys } from "../../lib/api/options";
import {
  dateTime,
  fieldLabel,
  relativeTime,
  textValue,
} from "../../lib/display";
import { usePagination } from "../../lib/pagination";
import type { ApiKey } from "../../lib/types";
import { PermissionBadges } from "./permissions";
import { fetchKeys, revokeKey, useKeysPage, useRefreshKeys } from "./queries";
import { CopyKeyButton } from "./reveal";

const pageSize = 50;

/** The caller's keys with sorting, CSV export and revocation. */
export function KeysTable({ onCreate }: { onCreate: () => void }) {
  const { organization } = useWorkspace();
  const pagination = usePagination("created_at", keySortKeys);
  const refresh = useRefreshKeys(organization.id);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  const keys = useKeysPage(organization.id, {
    cursor: pagination.cursor,
    limit: pageSize,
    sort: pagination.sort,
    order: pagination.direction,
  });
  const columns = useMemo<ColumnDef<ApiKey>[]>(
    () => [
      {
        accessorKey: "name",
        header: fieldLabel("name"),
        cell: ({ row }) => (
          <span className="font-medium">{textValue(row.original.name)}</span>
        ),
      },
      {
        id: "permissions",
        header: fieldLabel("permissions"),
        enableSorting: false,
        accessorFn: (row) =>
          [
            ...(row.permissions.sessions ?? []),
            ...((row.permissions.admin ?? []).length ? ["admin"] : []),
          ].join(" "),
        cell: ({ row }) => (
          <PermissionBadges permissions={row.original.permissions} />
        ),
      },
      {
        accessorKey: "created_at",
        header: fieldLabel("created_at"),
        cell: ({ row }) => dateTime(row.original.created_at),
      },
      {
        accessorKey: "expires_at",
        header: fieldLabel("expires_at"),
        cell: ({ row }) =>
          row.original.expires_at === null
            ? copy.keys.list.never
            : dateTime(row.original.expires_at),
      },
      {
        accessorKey: "last_used_at",
        header: fieldLabel("last_used_at"),
        cell: ({ row }) =>
          row.original.last_used_at === null
            ? copy.keys.list.never
            : relativeTime(row.original.last_used_at),
      },
      {
        accessorKey: "enabled",
        header: fieldLabel("status"),
        cell: ({ row }) => (
          <Badge variant={row.original.enabled ? "success" : "neutral"}>
            {row.original.enabled
              ? copy.keys.list.active
              : copy.keys.list.revoked}
          </Badge>
        ),
      },
      {
        accessorKey: "id",
        header: fieldLabel("id"),
        enableSorting: false,
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1 font-mono text-xs">
            {row.original.id}
            <CopyButton value={row.original.id} />
          </span>
        ),
      },
      {
        accessorKey: "prefix",
        header: fieldLabel("prefix"),
        enableSorting: false,
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {textValue(row.original.prefix)}
          </span>
        ),
      },
      {
        id: "actions",
        header: copy.app.common.actions,
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1">
            {row.original.enabled && <CopyKeyButton keyId={row.original.id} />}
            <Button
              variant="ghost"
              size="sm"
              className="text-danger hover:text-danger"
              disabled={!row.original.enabled}
              onClick={() => {
                setRevoking(row.original);
              }}
            >
              {copy.keys.list.revoke}
            </Button>
          </span>
        ),
      },
    ],
    [],
  );
  return (
    <div className="flex flex-col gap-4" data-testid="keys-table">
      {keys.error !== null && (
        <RequestError
          error={keys.error}
          retry={() => {
            void keys.refetch();
          }}
        />
      )}
      <DataTable<ApiKey>
        data={keys.data?.items ?? []}
        columns={columns}
        sorting={pagination.sorting}
        onSortingChange={pagination.onSortingChange}
        loading={keys.isPending || keys.isFetching}
        rowId={(row) => row.id}
        hiddenColumns={["id", "prefix"]}
        label={copy.keys.list.label}
        emptyTitle={copy.keys.list.empty}
        emptyDescription={copy.keys.list.emptyHint}
        emptyAction={
          <Button onClick={onCreate}>
            <Plus aria-hidden />
            {copy.keys.create.action}
          </Button>
        }
        page={{
          index: pagination.pageIndex,
          hasNext: (keys.data?.cursor ?? null) !== null,
          onNext: () => {
            pagination.next(keys.data?.cursor ?? null);
          },
          onPrevious: pagination.previous,
        }}
        csv={{
          name: copy.keys.list.csvName,
          fetchAll: (cursor, signal) =>
            fetchKeys(
              {
                cursor,
                limit: 100,
                sort: pagination.sort,
                order: pagination.direction,
              },
              signal,
            ),
        }}
      />
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) setRevoking(null);
        }}
        title={copy.keys.revoke.title}
        description={copy.keys.revoke.description}
        confirmLabel={copy.keys.revoke.confirm}
        action={async (reason) => {
          if (!revoking) return;
          await revokeKey(revoking.id, reason);
          await refresh();
        }}
      >
        {revoking && (
          <p className="text-sm">
            <span className="font-medium">{textValue(revoking.name)}</span>
            <span className="text-muted">{copy.app.common.separator}</span>
            <PermissionBadges permissions={revoking.permissions} />
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}
