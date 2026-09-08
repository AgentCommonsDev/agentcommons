import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { formatInstallCommand } from "@agentcommons/core/format/install";
import { createPersonalKey } from "../lib/api/keys";
import { KeyRound, Plus } from "lucide-react";
import type { KeyPermissions } from "@agentcommons/core/schemas/common";
import { copy } from "../copy";
import { api, unwrap, defined } from "../lib/api/client";
import { keySortKeys } from "../lib/api/options";
import { usePagination } from "../lib/pagination";
import { dateTime, textValue } from "../lib/display";
import type { paths } from "../lib/api/generated";
import type { ApiKey } from "../lib/types";
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
const endpoints = {
  own: { list: "/api/v1/me/keys", revoke: "/api/v1/me/keys/{id}" },
  admin: { list: "/api/v1/admin/keys", revoke: "/api/v1/admin/keys/{id}" },
} as const;
type KeyFilters = NonNullable<
  NonNullable<paths["/api/v1/me/keys"]["get"]["parameters"]["query"]>["filters"]
>;
export function KeysPage({ admin = false }: { admin?: boolean }) {
  const { organization, me } = useWorkspace();
  const client = useQueryClient();
  const pagination = usePagination("created_at", keySortKeys);
  const endpoint = endpoints[admin ? "admin" : "own"];
  const [filters, setFilters] = useState<KeyFilters>({});
  const [filterUser, setFilterUser] = useState("");
  const [filterEnabled, setFilterEnabled] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [days, setDays] = useState("");
  const [ingest, setIngest] = useState(true);
  const [read, setRead] = useState(true);
  const [administrator, setAdministrator] = useState(false);
  const [revoke, setRevoke] = useState<ApiKey | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const query = useQuery({
    queryKey: [
      organization.id,
      endpoint.list,
      filters,
      pagination.cursor,
      pagination.sort,
      pagination.direction,
    ],
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET(endpoint.list, {
          params: {
            query: {
              filters,
              cursor: pagination.cursor,
              limit: 50,
              sort: pagination.sort,
              order: pagination.direction,
              format: "json",
            },
          },
          signal,
        }),
      ),
  });
  const create = useMutation({
    mutationFn: async () => {
      const sessions: ("ingest" | "read")[] = [
        ...(ingest ? ["ingest" as const] : []),
        ...(read ? ["read" as const] : []),
      ];
      const permissions: KeyPermissions = {
        sessions,
        ...(administrator ? { admin: ["*"] } : {}),
      };
      const result = await createPersonalKey({
        name,
        permissions: defined(permissions),
        ...(days === ""
          ? {}
          : { expires_in: Math.floor(Number(days) * 86400) }),
      });
      setSecret(result.key);
      return result.metadata;
    },
    onSuccess: async () => {
      setCreateOpen(false);
      setName("");
      await client.invalidateQueries({ queryKey: [organization.id] });
    },
  });
  const columns = useMemo<ColumnDef<ApiKey>[]>(
    () => [
      {
        accessorKey: "name",
        header: copy.workspace.fields.name,
        cell: ({ getValue }) => textValue(getValue()),
      },
      {
        accessorKey: "id",
        header: copy.workspace.fields.id,
        enableSorting: false,
        cell: ({ row }) => (
          <span>
            {row.original.id}
            <CopyButton value={row.original.id} />
          </span>
        ),
      },
      {
        accessorKey: "organization_id",
        header: copy.workspace.fields.organization_id,
        enableSorting: false,
      },
      {
        accessorKey: "user_email",
        header: copy.workspace.fields.user_email,
        enableSorting: false,
      },
      {
        accessorKey: "user_name",
        header: copy.workspace.fields.name,
        enableSorting: false,
      },
      { accessorKey: "user_id", header: copy.workspace.fields.user_id },
      {
        accessorKey: "prefix",
        header: copy.workspace.fields.prefix,
        enableSorting: false,
      },
      {
        accessorKey: "permissions",
        header: copy.workspace.fields.permissions,
        enableSorting: false,
        cell: ({ getValue }) => textValue(getValue()),
      },
      {
        accessorKey: "enabled",
        header: copy.workspace.fields.enabled,
        cell: ({ row }) =>
          row.original.enabled
            ? copy.workspace.common.enabled
            : copy.workspace.common.disabled,
      },
      {
        accessorKey: "created_at",
        header: copy.workspace.fields.created_at,
        cell: ({ row }) => dateTime(row.original.created_at),
      },
      {
        accessorKey: "expires_at",
        header: copy.workspace.fields.expires_at,
        cell: ({ row }) => dateTime(row.original.expires_at),
      },
      {
        accessorKey: "last_used_at",
        header: copy.workspace.fields.last_used_at,
        cell: ({ row }) => dateTime(row.original.last_used_at),
      },
      {
        id: "actions",
        header: copy.workspace.common.actions,
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="small"
            disabled={!row.original.enabled}
            onClick={() => {
              setRevoke(row.original);
            }}
          >
            {copy.workspace.keys.revoke}
          </Button>
        ),
      },
    ],
    [],
  );
  const install = secret
    ? formatInstallCommand(window.location.origin, secret)
    : "";
  return (
    <>
      <PageHeading
        title={
          admin ? copy.workspace.keys.adminTitle : copy.workspace.keys.title
        }
        description={copy.workspace.keys.description}
        actions={
          !admin && (
            <Button
              onClick={() => {
                setCreateOpen(!createOpen);
                create.reset();
              }}
            >
              <Plus size={15} aria-hidden />
              {copy.workspace.keys.create}
            </Button>
          )
        }
      />
      {secret && (
        <section className="workspace-panel secret-panel">
          <h2>
            <KeyRound size={18} aria-hidden />
            {copy.workspace.keys.secretTitle}
          </h2>
          <p>{copy.workspace.keys.secretDescription}</p>
          <div className="secret-value">
            <code>{secret}</code>
            <CopyButton value={secret} />
          </div>
          <h3>{copy.workspace.keys.install}</h3>
          <p>{copy.workspace.keys.installHint}</p>
          <div className="secret-value">
            <code>{install}</code>
            <CopyButton value={install} />
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              setSecret(null);
              create.reset();
            }}
          >
            {copy.workspace.keys.dismiss}
          </Button>
        </section>
      )}
      {createOpen && (
        <form
          className="workspace-panel"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <h2>{copy.workspace.keys.create}</h2>
          <div className="form-grid">
            <Field
              label={copy.workspace.keys.name}
              hint={copy.workspace.keys.nameHint}
            >
              {(props) => (
                <input
                  {...props}
                  required
                  maxLength={128}
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                  }}
                />
              )}
            </Field>
            <Field
              label={copy.workspace.keys.expires}
              hint={copy.workspace.keys.noExpiry}
            >
              {(props) => (
                <input
                  {...props}
                  type="number"
                  min={1}
                  max={365}
                  value={days}
                  onChange={(event) => {
                    setDays(event.target.value);
                  }}
                />
              )}
            </Field>
          </div>
          <fieldset className="permissions-fieldset">
            <legend>{copy.workspace.keys.permissions}</legend>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={ingest}
                onChange={(event) => {
                  setIngest(event.target.checked);
                }}
              />
              {copy.workspace.keys.permissionLabels.ingest}
            </label>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={read}
                onChange={(event) => {
                  setRead(event.target.checked);
                }}
              />
              {copy.workspace.keys.permissionLabels.read}
            </label>
            {me.caller?.role !== "member" && (
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={administrator}
                  onChange={(event) => {
                    setAdministrator(event.target.checked);
                  }}
                />
                {copy.workspace.keys.permissionLabels.admin}
              </label>
            )}
          </fieldset>
          {create.error && <RequestError error={create.error} />}
          <div className="form-actions">
            <Button
              variant="secondary"
              type="button"
              onClick={() => {
                setCreateOpen(false);
              }}
            >
              {copy.workspace.common.cancel}
            </Button>
            <Button
              type="submit"
              disabled={
                create.isPending || (!ingest && !read && !administrator)
              }
            >
              {create.isPending
                ? copy.workspace.common.saving
                : copy.workspace.keys.create}
            </Button>
          </div>
        </form>
      )}
      {query.error && (
        <RequestError
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
        />
      )}
      <form
        className="filter-row"
        onSubmit={(event) => {
          event.preventDefault();
          setFilters({
            ...(filterUser.trim() ? { user_id: filterUser.trim() } : {}),
            ...(filterEnabled ? { enabled: filterEnabled === "true" } : {}),
          });
          pagination.reset();
        }}
      >
        {admin && (
          <input
            aria-label={copy.workspace.fields.user_id}
            placeholder={copy.workspace.fields.user_id}
            value={filterUser}
            onChange={(event) => {
              setFilterUser(event.target.value);
            }}
          />
        )}
        <Field label={copy.workspace.fields.enabled}>
          {(props) => (
            <select
              {...props}
              aria-label={copy.workspace.fields.enabled}
              value={filterEnabled}
              onChange={(event) => {
                setFilterEnabled(event.target.value);
              }}
            >
              <option value="">{copy.workspace.common.all}</option>
              <option value="true">{copy.workspace.common.enabled}</option>
              <option value="false">{copy.workspace.common.disabled}</option>
            </select>
          )}
        </Field>
        <Button type="submit" variant="secondary">
          {copy.workspace.common.apply}
        </Button>
      </form>
      {!query.error && (
        <DataTable
          summaryColumnIds={
            admin
              ? ["name", "user_email", "permissions", "created_at"]
              : ["name", "permissions", "created_at", "expires_at"]
          }
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
          label={
            admin ? copy.workspace.keys.adminTitle : copy.workspace.keys.title
          }
          csvName={copy.workspace.keys.csvName}
          fetchExportPage={async (cursor, signal) =>
            unwrap(
              await api.GET(endpoint.list, {
                params: {
                  query: {
                    filters,
                    cursor,
                    limit: 100,
                    sort: pagination.sort,
                    order: pagination.direction,
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
        open={revoke !== null}
        onOpenChange={(open) => {
          if (!open) setRevoke(null);
        }}
        title={copy.workspace.keys.revokeTitle}
        description={copy.workspace.keys.revokeDescription}
        confirmLabel={copy.workspace.keys.revoke}
        action={async (reason) => {
          if (!revoke) return;
          unwrap(
            await api.DELETE(endpoint.revoke, {
              params: { path: { id: revoke.id } },
              body: { reason },
            }),
          );
          await client.invalidateQueries({ queryKey: [organization.id] });
        }}
      />
    </>
  );
}
