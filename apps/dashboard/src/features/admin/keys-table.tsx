import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Ban } from "lucide-react";
import type { KeyToolGroup } from "@agentcommons/core/schemas/common";
import { copy } from "../../copy";
import { api, unwrap } from "../../lib/api/client";
import { keySortKeys } from "../../lib/api/options";
import type { ApiKey } from "../../lib/types";
import { useWorkspace } from "../../components/app/workspace";
import { DataTable } from "../../components/app/data-table";
import { ConfirmDialog } from "../../components/app/confirm-dialog";
import { keyColumns } from "../keys/keys-table";
import {
  BooleanFilterSelect,
  EnumFilterSelect,
  FilterBar,
  countActive,
} from "./filters";
import { useListPage } from "./list";
import { useMemberOptions } from "./members";
import { RowMenu, actionsHeader } from "./row-menu";

type Filters = { user_id?: string; enabled?: boolean };
const text = copy.admin.keys;
const keyName = (key: ApiKey) => key.name?.trim() || text.unnamed;
const ownerLabel = (key: ApiKey) =>
  key.user_email ?? key.user_name ?? key.user_id;

/**
 * The organization's keys as an admin sees them (`GET /admin/keys`), with owner, filters
 * and the audited admin revoke. All keys shows every key with the owner and status
 * filters; Management MCP shows the keys granting one tool group and no filter bar. One
 * table, one revoke flow: the group is a fixed server-side filter, so paging and the CSV
 * export cover the same rows.
 */
export function AdminKeysTable({
  toolGroup,
  testId,
  label,
  csvName,
  empty,
}: {
  /** Only keys whose permissions grant this group; omit for every key. */
  toolGroup?: KeyToolGroup | undefined;
  testId: string;
  label: string;
  csvName: string;
  empty: { title: string; hint: string };
}) {
  const { organization } = useWorkspace();
  const client = useQueryClient();
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  const queryKey = [organization.id, "admin", "keys", toolGroup ?? "all"];
  const fixed = toolGroup === undefined ? {} : { tool_group: toolGroup };
  const list = useListPage<ApiKey, (typeof keySortKeys)[number], Filters>({
    queryKey,
    initialSort: "created_at",
    sortKeys: keySortKeys,
    csvName,
    fetchPage: async (request, signal) =>
      unwrap(
        await api.GET("/api/v1/admin/keys", {
          params: {
            query: {
              ...request,
              filters: { ...request.filters, ...fixed },
              format: "json",
            },
          },
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
      <div data-testid={testId}>
        <DataTable
          {...list.table}
          columns={columns}
          label={label}
          hiddenColumns={["prefix", "id"]}
          rowId={(row) => row.id}
          emptyTitle={empty.title}
          emptyDescription={empty.hint}
          toolbar={
            toolGroup === undefined ? (
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
            ) : undefined
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
