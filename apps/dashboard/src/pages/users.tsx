import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { organizationRoleSchema } from "@agentcommons/core/schemas/common";
import { Plus } from "lucide-react";
import { copy } from "../copy";
import { api, unwrap } from "../lib/api/client";
import { memberSortKeys } from "../lib/api/options";
import { dateTime } from "../lib/display";
import { usePagination } from "../lib/pagination";
import type { Member } from "../lib/types";
import { useWorkspace } from "../components/workspace/context";
import { DataTable } from "../components/workspace/data-table";
import { ConfirmAction } from "../components/workspace/confirm-action";
import {
  CopyButton,
  Field,
  PageHeading,
  RequestError,
} from "../components/workspace/primitives";
import { Button } from "../components/ui/button";
type Role = Member["role"];
type Action = { member: Member } & (
  | { kind: "role"; role: Role }
  | { kind: "suspension"; suspended: boolean }
  | { kind: "remove" }
);
const confirmations = {
  role: {
    title: copy.workspace.users.roleTitle,
    description: copy.workspace.users.roleDescription,
    label: copy.workspace.common.save,
  },
  suspension: {
    title: copy.workspace.users.suspendTitle,
    description: copy.workspace.users.suspendDescription,
    label: copy.workspace.common.save,
  },
  remove: {
    title: copy.workspace.users.removeTitle,
    description: copy.workspace.users.removeDescription,
    label: copy.workspace.users.remove,
  },
};
export function UsersPage() {
  const { organization } = useWorkspace();
  const client = useQueryClient();
  const pagination = usePagination("created_at", memberSortKeys);
  const [addOpen, setAddOpen] = useState(false);
  const [emails, setEmails] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [action, setAction] = useState<Action | null>(null);
  const [emailFilter, setEmailFilter] = useState("");
  const [appliedEmail, setAppliedEmail] = useState("");
  const [roleFilter, setRoleFilter] = useState<Role | "">("");
  const [suspendedFilter, setSuspendedFilter] = useState("");
  const filters = {
    ...(appliedEmail ? { email: appliedEmail } : {}),
    ...(roleFilter ? { role: roleFilter } : {}),
    ...(suspendedFilter ? { suspended: suspendedFilter === "true" } : {}),
  };
  const query = useQuery({
    queryKey: [
      organization.id,
      "users",
      filters,
      pagination.cursor,
      pagination.sort,
      pagination.direction,
    ],
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET("/api/v1/admin/users", {
          params: {
            query: {
              filters,
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
  const add = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST("/api/v1/admin/users", {
          body: {
            emails: emails
              .split(/\r?\n/)
              .map((email) => email.trim())
              .filter(Boolean),
            role,
          },
        }),
      ),
    onSuccess: async () => {
      setEmails("");
      await client.invalidateQueries({ queryKey: [organization.id, "users"] });
    },
  });
  const setup = useMutation({
    mutationFn: async (userId: string) =>
      unwrap(
        await api.POST("/api/v1/admin/users/password-setup", {
          body: { user_id: userId },
        }),
      ),
  });
  const columns = useMemo<ColumnDef<Member>[]>(
    () => [
      { accessorKey: "email", header: copy.workspace.fields.email },
      { accessorKey: "name", header: copy.workspace.fields.name },
      {
        accessorKey: "role",
        header: copy.workspace.fields.role,
        cell: ({ row }) => (
          <select
            className="table-select"
            value={row.original.role}
            aria-label={`${copy.workspace.users.role} ${row.original.email}`}
            onChange={(event) => {
              setAction({
                member: row.original,
                kind: "role",
                role: organizationRoleSchema.parse(event.target.value),
              });
            }}
          >
            {organizationRoleSchema.options.map((value) => (
              <option key={value} value={value}>
                {copy.workspace.statuses[value]}
              </option>
            ))}
          </select>
        ),
      },
      {
        accessorKey: "suspended",
        header: copy.workspace.fields.suspended,
        cell: ({ row }) =>
          row.original.suspended
            ? copy.workspace.common.yes
            : copy.workspace.common.no,
      },
      {
        accessorKey: "created_at",
        header: copy.workspace.fields.created_at,
        cell: ({ row }) => dateTime(row.original.created_at),
      },
      {
        accessorKey: "user_id",
        header: copy.workspace.fields.user_id,
        enableSorting: false,
        cell: ({ row }) => (
          <span>
            {row.original.user_id}
            <CopyButton value={row.original.user_id} />
          </span>
        ),
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
              onClick={() => {
                setup.mutate(row.original.user_id);
              }}
            >
              {copy.workspace.users.setup}
            </Button>
            <Button
              size="small"
              variant="ghost"
              onClick={() => {
                setAction({
                  kind: "suspension",
                  member: row.original,
                  suspended: !row.original.suspended,
                });
              }}
            >
              {row.original.suspended
                ? copy.workspace.users.restore
                : copy.workspace.users.suspend}
            </Button>
            <Button
              size="small"
              variant="ghost"
              onClick={() => {
                setAction({ kind: "remove", member: row.original });
              }}
            >
              {copy.workspace.users.remove}
            </Button>
          </div>
        ),
      },
    ],
    [setup],
  );
  const confirmation = confirmations[action?.kind ?? "remove"];
  return (
    <>
      <PageHeading
        title={copy.workspace.users.title}
        description={copy.workspace.users.description}
        actions={
          <Button
            onClick={() => {
              setAddOpen(!addOpen);
              add.reset();
            }}
          >
            <Plus size={15} aria-hidden />
            {copy.workspace.users.add}
          </Button>
        }
      />
      {addOpen && (
        <form
          className="workspace-panel"
          onSubmit={(event) => {
            event.preventDefault();
            add.mutate();
          }}
        >
          <h2>{copy.workspace.users.add}</h2>
          <div className="form-grid">
            <Field
              label={copy.workspace.users.emails}
              hint={copy.workspace.users.emailsHint}
            >
              {(props) => (
                <textarea
                  {...props}
                  required
                  value={emails}
                  onChange={(event) => {
                    setEmails(event.target.value);
                  }}
                />
              )}
            </Field>
            <Field label={copy.workspace.users.role}>
              {(props) => (
                <select
                  {...props}
                  value={role}
                  onChange={(event) => {
                    setRole(organizationRoleSchema.parse(event.target.value));
                  }}
                >
                  {organizationRoleSchema.options.map((value) => (
                    <option key={value} value={value}>
                      {copy.workspace.statuses[value]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          {add.error && <RequestError error={add.error} />}
          {add.data && (
            <div className="access-results" role="status">
              {add.data.results.map((result) => (
                <div key={result.email}>
                  <span>{result.email}</span>
                  <span>{copy.workspace.users[result.status]}</span>
                  {result.setup_url && (
                    <CopyButton
                      value={result.setup_url}
                      label={copy.workspace.auth.setupLink}
                    />
                  )}
                  {result.error && <p>{result.error}</p>}
                </div>
              ))}
            </div>
          )}
          <div className="form-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setAddOpen(false);
                add.reset();
              }}
            >
              {copy.workspace.common.close}
            </Button>
            <Button type="submit" disabled={add.isPending}>
              {add.isPending
                ? copy.workspace.common.saving
                : copy.workspace.users.addSubmit}
            </Button>
          </div>
        </form>
      )}
      {setup.error && <RequestError error={setup.error} />}
      {setup.data && (
        <section className="workspace-panel secret-panel">
          <h2>{copy.workspace.users.setupTitle}</h2>
          <p>{copy.workspace.users.setupDescription}</p>
          <div className="secret-value">
            <code>{setup.data.setup_url}</code>
            <CopyButton value={setup.data.setup_url} />
          </div>
          <p>
            {copy.workspace.fields.expires_at}
            {copy.workspace.common.separator}
            {dateTime(setup.data.expires_at)}
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              setup.reset();
            }}
          >
            {copy.workspace.common.close}
          </Button>
        </section>
      )}
      <form
        className="filter-row"
        onSubmit={(event) => {
          event.preventDefault();
          setAppliedEmail(emailFilter.trim());
          pagination.reset();
        }}
      >
        <input
          type="email"
          aria-label={copy.workspace.fields.email}
          placeholder={copy.workspace.fields.email}
          value={emailFilter}
          onChange={(event) => {
            setEmailFilter(event.target.value);
          }}
        />
        <Field label={copy.workspace.fields.role}>
          {(props) => (
            <select
              {...props}
              aria-label={copy.workspace.fields.role}
              value={roleFilter}
              onChange={(event) => {
                setRoleFilter(
                  event.target.value
                    ? organizationRoleSchema.parse(event.target.value)
                    : "",
                );
                pagination.reset();
              }}
            >
              <option value="">{copy.workspace.common.all}</option>
              {organizationRoleSchema.options.map((value) => (
                <option key={value} value={value}>
                  {copy.workspace.statuses[value]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={copy.workspace.fields.suspended}>
          {(props) => (
            <select
              {...props}
              aria-label={copy.workspace.fields.suspended}
              value={suspendedFilter}
              onChange={(event) => {
                setSuspendedFilter(event.target.value);
                pagination.reset();
              }}
            >
              <option value="">{copy.workspace.common.all}</option>
              <option value="true">{copy.workspace.users.suspend}</option>
              <option value="false">{copy.workspace.common.enabled}</option>
            </select>
          )}
        </Field>
        <Button type="submit" variant="secondary">
          {copy.workspace.common.apply}
        </Button>
      </form>
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
          label={copy.workspace.users.title}
          csvName={copy.workspace.users.csvName}
          fetchExportPage={async (cursor, signal) =>
            unwrap(
              await api.GET("/api/v1/admin/users", {
                params: {
                  query: {
                    filters,
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
        title={confirmation.title}
        description={confirmation.description}
        confirmLabel={confirmation.label}
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
          else if (action.kind === "suspension")
            unwrap(
              await api.PATCH("/api/v1/admin/users/{id}/suspension", {
                params,
                body: { suspended: action.suspended, reason },
              }),
            );
          else
            unwrap(
              await api.DELETE("/api/v1/admin/users/{id}", {
                params,
                body: { reason },
              }),
            );
          await client.invalidateQueries({
            queryKey: [organization.id, "users"],
          });
        }}
      />
    </>
  );
}
