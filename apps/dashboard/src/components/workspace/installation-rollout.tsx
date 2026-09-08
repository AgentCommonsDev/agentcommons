import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { installationSortKeys } from "@agentcommons/core/schemas/rest";
import type { ColumnDef } from "@tanstack/react-table";
import type { operations } from "../../lib/api/generated";
import { api, unwrap } from "../../lib/api/client";
import { copy } from "../../copy";
import { dateTime } from "../../lib/display";
import { usePagination } from "../../lib/pagination";
import { useWorkspace } from "./context";
import { DataTable } from "./data-table";
import { ConfirmAction } from "./confirm-action";
import { RequestError, Field, ShortenedFields } from "./primitives";
import { Button } from "../ui/button";
type Installation =
  operations["get_installations"]["responses"][200]["content"]["application/json"]["items"][number];
export function InstallationRollout() {
  const { organization } = useWorkspace();
  const client = useQueryClient();
  const pagination = usePagination("last_seen_at", installationSortKeys);
  const [draft, setDraft] = useState({ hostname: "", enabled: "" });
  const [applied, setApplied] = useState(draft);
  const filters = {
    ...(applied.hostname.trim() ? { hostname: applied.hostname.trim() } : {}),
    ...(applied.enabled ? { tools_enabled: applied.enabled === "true" } : {}),
  };
  const parameters = {
    filters,
    sort: pagination.sort,
    order: pagination.direction,
    format: "json" as const,
  };
  const [selected, setSelected] = useState<Installation | null>(null);
  const query = useQuery({
    queryKey: [organization.id, "installations", pagination.cursor, parameters],
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET("/api/v1/installations", {
          params: {
            query: { ...parameters, limit: 50, cursor: pagination.cursor },
          },
          signal,
        }),
      ),
  });
  const columns = useMemo<ColumnDef<Installation>[]>(
    () =>
      (
        [
          {
            accessorKey: "hostname",
            header: copy.workspace.fields.installation_hostname,
          },
          {
            accessorKey: "tools_enabled",
            header: copy.workspace.systemStatus.dimensions.tools_enabled,
            cell: ({ row }) =>
              row.original.tools_enabled
                ? copy.workspace.systemStatus.toolsEnabled
                : copy.workspace.systemStatus.toolsDisabled,
          },
          { accessorKey: "session_count", header: copy.workspace.common.count },
          {
            accessorKey: "last_seen_at",
            header: copy.workspace.fields.last_seen_at,
            cell: ({ row }) => dateTime(row.original.last_seen_at),
          },
          {
            accessorKey: "installation_id",
            header: copy.workspace.fields.installation_id,
          },
          { accessorKey: "os_user", header: copy.workspace.fields.os_user },
          { accessorKey: "platform", header: copy.workspace.fields.platform },
          { accessorKey: "arch", header: copy.workspace.fields.arch },
          {
            accessorKey: "truncated_fields",
            header: copy.workspace.fields.truncated_fields,
            cell: ({ row }) => (
              <ShortenedFields fields={row.original.truncated_fields} />
            ),
          },
          {
            id: "actions",
            header: copy.workspace.common.actions,
            cell: ({ row }) => (
              <Button
                variant="secondary"
                onClick={() => {
                  setSelected(row.original);
                }}
              >
                {row.original.tools_enabled
                  ? copy.workspace.systemStatus.disableTools
                  : copy.workspace.systemStatus.enableTools}
              </Button>
            ),
          },
        ] satisfies ColumnDef<Installation>[]
      ).map((column) => ({
        ...column,
        enableSorting:
          "accessorKey" in column &&
          installationSortKeys.some((key) => key === column.accessorKey),
      })),
    [],
  );
  return (
    <section
      className="metric-section"
      aria-labelledby="installation-rollout-title"
    >
      <h2 id="installation-rollout-title">
        {copy.workspace.systemStatus.installations}
      </h2>
      <p className="field-hint">
        {copy.workspace.systemStatus.installationDescription}
      </p>
      <form
        className="inline-admin-filter"
        onSubmit={(event) => {
          event.preventDefault();
          setApplied({ ...draft });
          pagination.reset();
        }}
      >
        <Field label={copy.workspace.fields.installation_hostname}>
          {(props) => (
            <input
              {...props}
              value={draft.hostname}
              type="text"
              onChange={(event) => {
                setDraft((prior) => ({
                  ...prior,
                  hostname: event.target.value,
                }));
              }}
            />
          )}
        </Field>
        <Field label={copy.workspace.systemStatus.dimensions.tools_enabled}>
          {(props) => (
            <select
              {...props}
              value={draft.enabled}
              onChange={(event) => {
                setDraft((prior) => ({
                  ...prior,
                  enabled: event.target.value,
                }));
              }}
            >
              <option value="">{copy.workspace.common.all}</option>
              <option value="true">
                {copy.workspace.systemStatus.toolsEnabled}
              </option>
              <option value="false">
                {copy.workspace.systemStatus.toolsDisabled}
              </option>
            </select>
          )}
        </Field>
        <Button type="submit" variant="secondary">
          {copy.workspace.common.apply}
        </Button>
      </form>
      {query.error ? (
        <RequestError
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
        />
      ) : (
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
          label={copy.workspace.systemStatus.installations}
          csvName={copy.workspace.systemStatus.installationCsvName}
          fetchExportPage={async (cursor, signal) =>
            unwrap(
              await api.GET("/api/v1/installations", {
                params: { query: { ...parameters, limit: 100, cursor } },
                signal,
              }),
            )
          }
        />
      )}
      <ConfirmAction
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        title={
          selected?.tools_enabled
            ? copy.workspace.systemStatus.disableTitle
            : copy.workspace.systemStatus.enableTitle
        }
        description={copy.workspace.systemStatus.rolloutConfirmation}
        confirmLabel={
          selected?.tools_enabled
            ? copy.workspace.systemStatus.disableTools
            : copy.workspace.systemStatus.enableTools
        }
        action={async (reason) => {
          if (!selected) return;
          unwrap(
            await api.POST("/api/v1/admin/installations/{id}/tools", {
              params: { path: { id: selected.installation_id } },
              body: { enabled: !selected.tools_enabled, reason },
            }),
          );
          await client.invalidateQueries({
            queryKey: [organization.id, "installations"],
          });
          await client.invalidateQueries({
            queryKey: [organization.id, "metrics"],
          });
        }}
      />
    </section>
  );
}
