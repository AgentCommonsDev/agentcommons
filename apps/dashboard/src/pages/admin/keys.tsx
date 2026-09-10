import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Ban } from "lucide-react";
import { copy } from "../../copy";
import { api, unwrap } from "../../lib/api/client";
import { keySortKeys } from "../../lib/api/options";
import type { ApiKey } from "../../lib/types";
import { useWorkspace } from "../../components/app/workspace";
import { DataTable } from "../../components/app/data-table";
import { ConfirmDialog } from "../../components/app/confirm-dialog";
import { PageHeader } from "../../components/ui/feedback";
import { useListPage } from "../../features/admin/list";
import {
  BooleanFilterSelect,
  EnumFilterSelect,
  FilterBar,
  countActive,
} from "../../features/admin/filters";
import { useMemberOptions } from "../../features/admin/members";
import { RowMenu, actionsHeader } from "../../features/admin/row-menu";
import { keyColumns } from "../../features/keys/keys-table";

type Filters = { user_id?: string; enabled?: boolean };
const text = copy.admin.keys;
const keyName = (key: ApiKey) => key.name?.trim() || text.unnamed;
const ownerLabel = (key: ApiKey) =>
  key.user_email ?? key.user_name ?? key.user_id;

export function AdminKeysPage() {
  const { organization } = useWorkspace();
  const client = useQueryClient();
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  const queryKey = [organization.id, "admin", "keys"];
  const list = useListPage<ApiKey, (typeof keySortKeys)[number], Filters>({
    queryKey,
    initialSort: "created_at",
    sortKeys: keySortKeys,
    csvName: text.csvName,
    fetchPage: async (request, signal) =>
      unwrap(
        await api.GET("/api/v1/admin/keys", {
          params: { query: { ...request, format: "json" } },
          signal,
        }),
      ),
  });
  const owners = useMemberOptions();
  const columns = useMemo<ColumnDef<ApiKey>[]>(() => {
    // The same badges and words as the member Keys page, so a key reads the same
    // to its owner and to an admin; the owner column and revoke action are admin-only.
    const [name, ...shared] = keyColumns(keyName);
    return [
      ...(name ? [name] : []),
      {
        id: "owner",
        accessorFn: ownerLabel,
        header: text.owner,
        enableSorting: false,
        size: 170,
        cell: ({ row }) => ownerLabel(row.original),
      },
      ...shared,
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
    ];
  }, []);
  const ownerIds = (owners.data ?? []).map((member) => member.user_id);
  return (
    <>
      <PageHeader title={text.title} description={text.description} />
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
              activeCount={countActive(list.filters)}
              onApply={() => {
                list.setFilters(list.filters);
              }}
              onClear={() => {
                list.setFilters({});
              }}
              controls={[
                {
                  id: "owner",
                  label: text.owner,
                  width: "sm:w-64",
                  render: (props) => (
                    <EnumFilterSelect
                      {...props}
                      value={list.filters.user_id}
                      options={ownerIds}
                      optionLabel={(id) =>
                        owners.data?.find((member) => member.user_id === id)
                          ?.email ?? id
                      }
                      allLabel={text.allOwners}
                      onChange={(next) => {
                        list.setFilter("user_id", next);
                      }}
                    />
                  ),
                },
                {
                  id: "state",
                  label: text.state,
                  width: "sm:w-36",
                  render: (props) => (
                    <BooleanFilterSelect
                      {...props}
                      value={list.filters.enabled}
                      labels={{
                        all: text.allStates,
                        on: copy.keys.list.active,
                        off: copy.keys.list.revoked,
                      }}
                      onChange={(next) => {
                        list.setFilter("enabled", next);
                      }}
                    />
                  ),
                },
              ]}
            />
          }
        />
      </div>
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
