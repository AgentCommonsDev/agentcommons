import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { ConfirmDialog } from "../../components/app/confirm-dialog";
import { DataTable } from "../../components/app/data-table";
import { CopyButton } from "../../components/app/states";
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
import { PermissionBadges, permissionSummary } from "./permissions";
import { fetchKeys, revokeKey, useKeysPage, useRefreshKeys } from "./queries";
import { CopyKeyButton } from "./reveal";

const pageSize = 50;
/**
 * The columns every keys table shares, so a key reads the same to its owner and to an
 * admin. `nameText` decides how a key without a name is shown.
 */
export function keyColumns(
  nameText: (key: ApiKey) => string,
): ColumnDef<ApiKey>[] {
  return [
    {
      accessorKey: "name",
      header: fieldLabel("name"),
      size: 200,
      cell: ({ row }) => (
        <span className="font-medium">{nameText(row.original)}</span>
      ),
    },
    {
      id: "permissions",
      header: fieldLabel("permissions"),
      enableSorting: false,
      size: 160,
      accessorFn: (row) => permissionSummary(row.permissions),
      cell: ({ row }) => (
        <PermissionBadges permissions={row.original.permissions} />
      ),
    },
    {
      accessorKey: "created_at",
      header: fieldLabel("created_at"),
      size: 120,
      cell: ({ row }) => dateTime(row.original.created_at),
    },
    {
      accessorKey: "expires_at",
      header: fieldLabel("expires_at"),
      size: 110,
      cell: ({ row }) =>
        row.original.expires_at === null
          ? copy.keys.list.never
          : dateTime(row.original.expires_at),
    },
    {
      accessorKey: "last_used_at",
      header: fieldLabel("last_used_at"),
      size: 100,
      cell: ({ row }) =>
        row.original.last_used_at === null
          ? copy.keys.list.never
          : relativeTime(row.original.last_used_at),
    },
    {
      accessorKey: "enabled",
      header: fieldLabel("status"),
      size: 80,
      cell: ({ row }) => (
        <Badge variant={row.original.enabled ? "success" : "neutral"}>
          {row.original.enabled
            ? copy.keys.list.active
            : copy.keys.list.revoked}
        </Badge>
      ),
    },
    {
      accessorKey: "prefix",
      header: fieldLabel("prefix"),
      enableSorting: false,
      size: 100,
      cell: ({ row }) => (
        <span className="font-mono text-xs">
          {textValue(row.original.prefix)}
        </span>
      ),
    },
    {
      accessorKey: "id",
      header: fieldLabel("id"),
      enableSorting: false,
      size: 220,
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-1 font-mono text-xs">
          {row.original.id}
          <CopyButton value={row.original.id} />
        </span>
      ),
    },
  ];
}

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
      ...keyColumns((key) => textValue(key.name)),
      {
        id: "actions",
        header: copy.app.common.actions,
        enableSorting: false,
        enableHiding: false,
        // Copy and Revoke share the cell and wrap under each other where it is narrow.
        size: 120,
        cell: ({ row }) => (
          <span className="flex flex-wrap items-center gap-1">
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
      <DataTable<ApiKey>
        data={keys.data?.items ?? []}
        columns={columns}
        sorting={pagination.sorting}
        onSortingChange={pagination.onSortingChange}
        loading={keys.isPending || keys.isFetching}
        error={keys.error}
        retry={() => {
          void keys.refetch();
        }}
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
        page={pagination.page(keys.data?.cursor)}
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
