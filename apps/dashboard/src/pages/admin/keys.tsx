import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Ban } from "lucide-react";
import { copy } from "../../copy";
import { api, unwrap } from "../../lib/api/client";
import { keySortKeys } from "../../lib/api/options";
import { dateTime, relativeTime } from "../../lib/display";
import type { ApiKey } from "../../lib/types";
import { useWorkspace } from "../../components/app/workspace";
import { DataTable } from "../../components/app/data-table";
import { ConfirmDialog } from "../../components/app/confirm-dialog";
import { CopyButton, RequestError } from "../../components/app/states";
import { Badge } from "../../components/ui/badge";
import { PageHeader } from "../../components/ui/feedback";
import { NativeSelect } from "../../components/ui/input";
import { useListPage } from "../../features/admin/list";
import { FilterBar, countActive, without } from "../../features/admin/filters";
import { RowMenu, actionsHeader } from "../../features/admin/row-menu";
import {
  PermissionBadges,
  permissionSummary,
} from "../../features/keys/permissions";

type Filters = { user_id?: string; enabled?: boolean };
const text = copy.admin.keys;
const keyName = (key: ApiKey) => key.name?.trim() || text.unnamed;
const ownerLabel = (key: ApiKey) =>
  key.user_email ?? key.user_name ?? key.user_id;

export function AdminKeysPage() {
  const { organization } = useWorkspace();
  const client = useQueryClient();
  const [filters, setFilters] = useState<Filters>({});
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  const queryKey = [organization.id, "admin", "keys"];
  const list = useListPage<ApiKey, (typeof keySortKeys)[number]>({
    queryKey: [...queryKey, filters],
    initialSort: "created_at",
    sortKeys: keySortKeys,
    csvName: text.csvName,
    fetchPage: async (request, signal) =>
      unwrap(
        await api.GET("/api/v1/admin/keys", {
          params: { query: { filters, ...request, format: "json" } },
          signal,
        }),
      ),
  });
  const owners = useQuery({
    queryKey: [organization.id, "admin", "users", "owners"],
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET("/api/v1/admin/users", {
          params: {
            query: { limit: 100, sort: "email", order: "asc", format: "json" },
          },
          signal,
        }),
      ),
    staleTime: 60_000,
  });
  const update = (next: Filters) => {
    setFilters(next);
    list.reset();
  };
  const columns = useMemo<ColumnDef<ApiKey>[]>(
    () => [
      {
        accessorKey: "name",
        header: copy.app.fields.name,
        cell: ({ row }) => (
          <span className="font-medium">{keyName(row.original)}</span>
        ),
      },
      {
        id: "owner",
        accessorFn: ownerLabel,
        header: text.owner,
        enableSorting: false,
        cell: ({ row }) => ownerLabel(row.original),
      },
      {
        // The same badges and words as the member Keys page, so a key reads the same
        // to its owner and to an admin.
        id: "permissions",
        accessorFn: (key) => permissionSummary(key.permissions),
        header: copy.app.fields.permissions,
        enableSorting: false,
        cell: ({ row }) => (
          <PermissionBadges permissions={row.original.permissions} />
        ),
      },
      {
        accessorKey: "created_at",
        header: copy.app.common.created,
        cell: ({ row }) => dateTime(row.original.created_at),
      },
      {
        accessorKey: "expires_at",
        header: copy.app.fields.expires_at,
        cell: ({ row }) =>
          row.original.expires_at === null
            ? copy.keys.list.never
            : dateTime(row.original.expires_at),
      },
      {
        accessorKey: "last_used_at",
        header: copy.app.fields.last_used_at,
        cell: ({ row }) =>
          row.original.last_used_at === null
            ? copy.keys.list.never
            : relativeTime(row.original.last_used_at),
      },
      {
        accessorKey: "enabled",
        header: text.state,
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
        header: copy.app.fields.prefix,
        enableSorting: false,
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {row.original.prefix ?? copy.app.common.unavailable}
          </span>
        ),
      },
      {
        accessorKey: "id",
        header: copy.app.fields.id,
        enableSorting: false,
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1 font-mono text-xs">
            {row.original.id}
            <CopyButton value={row.original.id} />
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
                label: text.revoke,
                icon: Ban,
                destructive: true,
                disabled: !row.original.enabled,
                onSelect: () => {
                  setRevoking(row.original);
                },
              },
            ]}
          />
        ),
      },
    ],
    [],
  );
  return (
    <>
      <PageHeader title={text.title} description={text.description} />
      {list.query.error ? (
        <RequestError
          error={list.query.error}
          retry={() => {
            void list.query.refetch();
          }}
        />
      ) : (
        <div data-testid="admin-keys-table">
          <DataTable
            {...list.table}
            columns={columns}
            label={text.title}
            hiddenColumns={["prefix", "id"]}
            rowId={(row) => row.id}
            emptyTitle={text.empty}
            emptyDescription={text.emptyHint}
            toolbar={
              <FilterBar
                label={copy.app.common.filters}
                activeCount={countActive(filters)}
                onApply={() => {
                  update(filters);
                }}
                onClear={() => {
                  update({});
                }}
                controls={[
                  {
                    id: "owner",
                    label: text.owner,
                    width: "sm:w-64",
                    render: (props) => (
                      <NativeSelect
                        {...props}
                        value={filters.user_id ?? ""}
                        onChange={(event) => {
                          const rest = without(filters, "user_id");
                          update(
                            event.target.value
                              ? { ...rest, user_id: event.target.value }
                              : rest,
                          );
                        }}
                      >
                        <option value="">{text.allOwners}</option>
                        {(owners.data?.items ?? []).map((member) => (
                          <option key={member.user_id} value={member.user_id}>
                            {member.email}
                          </option>
                        ))}
                      </NativeSelect>
                    ),
                  },
                  {
                    id: "state",
                    label: text.state,
                    width: "sm:w-36",
                    render: (props) => (
                      <NativeSelect
                        {...props}
                        value={
                          filters.enabled === undefined
                            ? ""
                            : filters.enabled
                              ? "enabled"
                              : "revoked"
                        }
                        onChange={(event) => {
                          const rest = without(filters, "enabled");
                          update(
                            event.target.value
                              ? {
                                  ...rest,
                                  enabled: event.target.value === "enabled",
                                }
                              : rest,
                          );
                        }}
                      >
                        <option value="">{text.allStates}</option>
                        <option value="enabled">{copy.keys.list.active}</option>
                        <option value="revoked">
                          {copy.keys.list.revoked}
                        </option>
                      </NativeSelect>
                    ),
                  },
                ]}
              />
            }
          />
        </div>
      )}
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) setRevoking(null);
        }}
        title={text.revokeTitle}
        description={revoking ? text.revokeDescription(keyName(revoking)) : ""}
        confirmLabel={text.revoke}
        action={async (reason) => {
          if (!revoking) return;
          unwrap(
            await api.DELETE("/api/v1/admin/keys/{id}", {
              params: { path: { id: revoking.id } },
              body: { reason },
            }),
          );
          await client.invalidateQueries({ queryKey });
        }}
      />
    </>
  );
}
