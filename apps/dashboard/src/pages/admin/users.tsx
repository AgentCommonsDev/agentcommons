import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { organizationRoleSchema } from "@agentcommons/core/schemas/common";
import { KeyRound, Plus, UserCheck, UserMinus, UserX } from "lucide-react";
import { copy } from "../../copy";
import { api, unwrap } from "../../lib/api/client";
import { memberSortKeys } from "../../lib/api/options";
import { dateTime, statusLabel } from "../../lib/display";
import type { Member } from "../../lib/types";
import { useWorkspace } from "../../components/app/workspace";
import { DataTable } from "../../components/app/data-table";
import { ConfirmDialog } from "../../components/app/confirm-dialog";
import { CopyButton, RequestError } from "../../components/app/states";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { PageHeader } from "../../components/ui/feedback";
import { Input, NativeSelect } from "../../components/ui/input";
import { useListPage } from "../../features/admin/list";
import { FilterBar, countActive, without } from "../../features/admin/filters";
import { RowMenu, actionsHeader } from "../../features/admin/row-menu";
import {
  AddPeopleDialog,
  PasswordSetupDialog,
  RoleSelect,
  roles,
  type Role,
} from "../../features/admin/members";

type Filters = { email?: string; role?: Role; suspended?: boolean };
type Action = { member: Member } & (
  | { kind: "role"; role: Role }
  | { kind: "suspend" }
  | { kind: "restore" }
  | { kind: "remove" }
);
const text = copy.admin.users;
function describe(action: Action | null) {
  if (!action)
    return {
      title: "",
      description: "",
      label: copy.app.common.save,
      destructive: false,
    };
  const email = action.member.email;
  switch (action.kind) {
    case "role":
      return {
        title: text.roleTitle,
        description: text.roleDescription(email, statusLabel(action.role)),
        label: copy.app.common.save,
        destructive: false,
      };
    case "suspend":
      return {
        title: text.suspendTitle,
        description: text.suspendDescription(email),
        label: text.suspend,
        destructive: true,
      };
    case "restore":
      return {
        title: text.restoreTitle,
        description: text.restoreDescription(email),
        label: text.restore,
        destructive: false,
      };
    case "remove":
      return {
        title: text.removeTitle,
        description: text.removeDescription(email),
        label: copy.app.common.remove,
        destructive: true,
      };
  }
}
export function UsersPage() {
  const { organization, me } = useWorkspace();
  const client = useQueryClient();
  const [emailDraft, setEmailDraft] = useState("");
  const [filters, setFilters] = useState<Filters>({});
  const [addOpen, setAddOpen] = useState(false);
  const [setupMember, setSetupMember] = useState<Member | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const queryKey = [organization.id, "admin", "users"];
  const list = useListPage<Member, (typeof memberSortKeys)[number]>({
    queryKey: [...queryKey, filters],
    initialSort: "created_at",
    sortKeys: memberSortKeys,
    csvName: text.csvName,
    fetchPage: async (request, signal) =>
      unwrap(
        await api.GET("/api/v1/admin/users", {
          params: { query: { filters, ...request, format: "json" } },
          signal,
        }),
      ),
  });
  const update = (next: Filters) => {
    setFilters(next);
    list.reset();
  };
  const refresh = () => client.invalidateQueries({ queryKey });
  const columns = useMemo<ColumnDef<Member>[]>(
    () => [
      {
        accessorKey: "email",
        header: copy.app.fields.email,
        cell: ({ row }) => (
          <span className="font-medium">{row.original.email}</span>
        ),
      },
      {
        accessorKey: "name",
        header: copy.app.fields.name,
        cell: ({ row }) =>
          row.original.name && row.original.name !== row.original.email
            ? row.original.name
            : copy.app.common.unavailable,
      },
      {
        accessorKey: "role",
        header: copy.app.fields.role,
        cell: ({ row }) => (
          <RoleSelect
            className="w-32"
            label={text.roleSelect(row.original.email)}
            value={row.original.role}
            disabled={row.original.user_id === me.user.id}
            onChange={(role) => {
              if (role !== row.original.role)
                setAction({ kind: "role", member: row.original, role });
            }}
          />
        ),
      },
      {
        accessorKey: "suspended",
        header: text.filterStatus,
        cell: ({ row }) => (
          <Badge variant={row.original.suspended ? "warning" : "success"}>
            {row.original.suspended ? text.suspended : text.active}
          </Badge>
        ),
      },
      {
        accessorKey: "created_at",
        header: text.addedAt,
        cell: ({ row }) => dateTime(row.original.created_at),
      },
      {
        accessorKey: "user_id",
        header: copy.app.fields.user_id,
        enableSorting: false,
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1 font-mono text-xs">
            {row.original.user_id}
            <CopyButton value={row.original.user_id} />
          </span>
        ),
      },
      {
        id: "actions",
        header: actionsHeader,
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const member = row.original;
          const self = member.user_id === me.user.id;
          return (
            <RowMenu
              label={copy.app.common.actions}
              items={[
                {
                  label: text.setup,
                  icon: KeyRound,
                  onSelect: () => {
                    setSetupMember(member);
                  },
                },
                member.suspended
                  ? {
                      label: text.restore,
                      icon: UserCheck,
                      onSelect: () => {
                        setAction({ kind: "restore", member });
                      },
                    }
                  : {
                      label: text.suspend,
                      icon: UserX,
                      destructive: true,
                      disabled: self,
                      onSelect: () => {
                        setAction({ kind: "suspend", member });
                      },
                    },
                {
                  label: text.remove,
                  icon: UserMinus,
                  destructive: true,
                  disabled: self,
                  onSelect: () => {
                    setAction({ kind: "remove", member });
                  },
                },
              ]}
            />
          );
        },
      },
    ],
    [me.user.id],
  );
  const confirmation = describe(action);
  return (
    <>
      <PageHeader
        title={text.title}
        description={text.description}
        actions={
          <Button
            data-testid="admin-add-people"
            onClick={() => {
              setAddOpen(true);
            }}
          >
            <Plus aria-hidden />
            {text.add}
          </Button>
        }
      />
      {list.query.error ? (
        <RequestError
          error={list.query.error}
          retry={() => {
            void list.query.refetch();
          }}
        />
      ) : (
        <div data-testid="admin-users-table">
          <DataTable
            {...list.table}
            columns={columns}
            label={text.title}
            hiddenColumns={["user_id"]}
            rowId={(row) => row.id}
            emptyTitle={text.empty}
            emptyDescription={text.emptyHint}
            toolbar={
              <FilterBar
                label={copy.app.common.filters}
                activeCount={countActive(filters)}
                onApply={() => {
                  const rest = without(filters, "email");
                  const email = emailDraft.trim();
                  update(email ? { ...rest, email } : rest);
                }}
                onClear={() => {
                  setEmailDraft("");
                  update({});
                }}
                controls={[
                  {
                    id: "email",
                    label: text.filterEmail,
                    width: "sm:w-56",
                    render: (props) => (
                      <Input
                        {...props}
                        type="email"
                        placeholder={text.filterEmail}
                        value={emailDraft}
                        onChange={(event) => {
                          setEmailDraft(event.target.value);
                        }}
                      />
                    ),
                  },
                  {
                    id: "role",
                    label: text.filterRole,
                    width: "sm:w-36",
                    render: (props) => (
                      <NativeSelect
                        {...props}
                        value={filters.role ?? ""}
                        onChange={(event) => {
                          const rest = without(filters, "role");
                          update(
                            event.target.value
                              ? {
                                  ...rest,
                                  role: organizationRoleSchema.parse(
                                    event.target.value,
                                  ),
                                }
                              : rest,
                          );
                        }}
                      >
                        <option value="">{text.allRoles}</option>
                        {roles.map((role) => (
                          <option key={role} value={role}>
                            {statusLabel(role)}
                          </option>
                        ))}
                      </NativeSelect>
                    ),
                  },
                  {
                    id: "status",
                    label: text.filterStatus,
                    width: "sm:w-36",
                    render: (props) => (
                      <NativeSelect
                        {...props}
                        value={
                          filters.suspended === undefined
                            ? ""
                            : filters.suspended
                              ? "suspended"
                              : "active"
                        }
                        onChange={(event) => {
                          const rest = without(filters, "suspended");
                          update(
                            event.target.value
                              ? {
                                  ...rest,
                                  suspended: event.target.value === "suspended",
                                }
                              : rest,
                          );
                        }}
                      >
                        <option value="">{text.allStatuses}</option>
                        <option value="active">{text.active}</option>
                        <option value="suspended">{text.suspended}</option>
                      </NativeSelect>
                    ),
                  },
                ]}
              />
            }
          />
        </div>
      )}
      <AddPeopleDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onAdded={refresh}
      />
      <PasswordSetupDialog
        member={setupMember}
        onClose={() => {
          setSetupMember(null);
        }}
      />
      <ConfirmDialog
        open={action !== null}
        onOpenChange={(open) => {
          if (!open) setAction(null);
        }}
        title={confirmation.title}
        description={confirmation.description}
        confirmLabel={confirmation.label}
        destructive={confirmation.destructive}
        action={async (reason) => {
          if (!action) return;
          const params = { path: { id: action.member.id } };
          if (action.kind === "role")
            unwrap(
              await api.PATCH("/api/v1/admin/users/{id}/role", {
                params,
                body: { role: action.role, reason },
              }),
            );
          else if (action.kind === "remove")
            unwrap(
              await api.DELETE("/api/v1/admin/users/{id}", {
                params,
                body: { reason },
              }),
            );
          else
            unwrap(
              await api.PATCH("/api/v1/admin/users/{id}/suspension", {
                params,
                body: { suspended: action.kind === "suspend", reason },
              }),
            );
          await refresh();
        }}
      />
    </>
  );
}
