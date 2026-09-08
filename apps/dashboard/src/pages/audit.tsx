import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { transportSchema } from "@agentcommons/core/schemas/common";
import { copy } from "../copy";
import { api, unwrap } from "../lib/api/client";
import { auditSortKeys } from "../lib/api/options";
import { usePagination } from "../lib/pagination";
import { dateTime, number, textValue } from "../lib/display";
import type { AuditEvent } from "../lib/types";
import { useWorkspace } from "../components/workspace/context";
import { DataTable } from "../components/workspace/data-table";
import {
  CopyButton,
  Field,
  PageHeading,
  RequestError,
} from "../components/workspace/primitives";
import { Button } from "../components/ui/button";
const filterFields = [
  "user_id",
  "api_key_id",
  "installation_id",
  "request_id",
  "resource_id",
  "action",
  "status_code",
  "since",
  "until",
] as const;
export function AuditPage() {
  const { organization } = useWorkspace();
  const pagination = usePagination("ts", auditSortKeys);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [applied, setApplied] = useState<Record<string, string>>({});
  const { status_code, transport, ...rest } = applied;
  const filters = {
    ...rest,
    ...(status_code ? { status_code: Number(status_code) } : {}),
    ...(transport ? { transport: transportSchema.parse(transport) } : {}),
  };
  const query = useQuery({
    queryKey: [
      organization.id,
      "audit",
      filters,
      pagination.cursor,
      pagination.sort,
      pagination.direction,
    ],
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET("/api/v1/admin/audit", {
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
  const columns = useMemo<ColumnDef<AuditEvent>[]>(
    () => [
      {
        accessorKey: "ts",
        header: copy.workspace.fields.ts,
        cell: ({ row }) => dateTime(row.original.ts),
      },
      { accessorKey: "action", header: copy.workspace.fields.action },
      {
        accessorKey: "user_id",
        header: copy.workspace.fields.user_id,
        cell: ({ getValue }) => textValue(getValue()),
      },
      {
        accessorKey: "api_key_id",
        header: copy.workspace.fields.api_key_id,
        enableSorting: false,
        cell: ({ getValue }) => textValue(getValue()),
      },
      {
        accessorKey: "installation_id",
        header: copy.workspace.fields.installation_id,
        enableSorting: false,
        cell: ({ getValue }) => textValue(getValue()),
      },
      { accessorKey: "status_code", header: copy.workspace.fields.status_code },
      {
        accessorKey: "duration_ms",
        header: copy.workspace.fields.duration_ms,
        cell: ({ row }) => number(row.original.duration_ms),
      },
      { accessorKey: "transport", header: copy.workspace.fields.transport },
      {
        accessorKey: "auth_method",
        header: copy.workspace.fields.auth_method,
        enableSorting: false,
      },
      {
        accessorKey: "ip",
        header: copy.workspace.fields.ip,
        enableSorting: false,
      },
      {
        accessorKey: "user_agent",
        header: copy.workspace.fields.user_agent,
        enableSorting: false,
      },
      {
        accessorKey: "request_id",
        header: copy.workspace.fields.request_id,
        cell: ({ row }) => (
          <span>
            {row.original.request_id}
            <CopyButton value={row.original.request_id} />
          </span>
        ),
      },
      {
        accessorKey: "resource_ids",
        header: copy.workspace.fields.resource_ids,
        enableSorting: false,
        cell: ({ getValue }) => textValue(getValue()),
      },
      {
        accessorKey: "detail",
        header: copy.workspace.fields.detail,
        enableSorting: false,
        cell: ({ row }) => (
          <details>
            <summary>{copy.workspace.common.details}</summary>
            <pre className="audit-detail">
              {JSON.stringify(row.original.detail, null, 2)}
            </pre>
          </details>
        ),
      },
    ],
    [],
  );
  return (
    <>
      <PageHeading
        title={copy.workspace.audit.title}
        description={copy.workspace.audit.description}
      />
      <details className="session-details">
        <summary>{copy.workspace.audit.filters}</summary>
        <form
          className="admin-filter-form"
          onSubmit={(event) => {
            event.preventDefault();
            setApplied(
              Object.fromEntries(
                Object.entries(draft).filter(
                  ([, value]) => value.trim() !== "",
                ),
              ),
            );
            pagination.reset();
          }}
        >
          <div className="form-grid">
            {filterFields.map((key) => (
              <Field
                key={key}
                label={
                  key === "resource_id"
                    ? copy.workspace.fields.resource_ids
                    : copy.workspace.fields[key]
                }
              >
                {(props) => (
                  <input
                    {...props}
                    type={key === "status_code" ? "number" : "text"}
                    value={draft[key] ?? ""}
                    onChange={(event) => {
                      setDraft((prior) => ({
                        ...prior,
                        [key]: event.target.value,
                      }));
                    }}
                  />
                )}
              </Field>
            ))}
            <Field label={copy.workspace.fields.transport}>
              {(props) => (
                <select
                  {...props}
                  value={draft.transport ?? ""}
                  onChange={(event) => {
                    setDraft((prior) => ({
                      ...prior,
                      transport: event.target.value,
                    }));
                  }}
                >
                  <option value="">{copy.workspace.common.all}</option>
                  {transportSchema.options.map((value) => (
                    <option value={value} key={value}>
                      {value}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          <div className="form-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setDraft({});
                setApplied({});
                pagination.reset();
              }}
            >
              {copy.workspace.common.clear}
            </Button>
            <Button type="submit">{copy.workspace.common.apply}</Button>
          </div>
        </form>
      </details>
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
          label={copy.workspace.audit.title}
          csvName={copy.workspace.audit.csvName}
          fetchExportPage={async (cursor, signal) =>
            unwrap(
              await api.GET("/api/v1/admin/audit", {
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
    </>
  );
}
