import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { transportSchema } from "@agentcommons/core/schemas/common";
import { copy } from "../../copy";
import { api, unwrap } from "../../lib/api/client";
import { auditSortKeys } from "../../lib/api/options";
import { dateTime, metricValue, textValue, truncate } from "../../lib/display";
import type { AuditEvent } from "../../lib/types";
import { useWorkspace } from "../../components/app/workspace";
import { DataTable } from "../../components/app/data-table";
import { Button } from "../../components/ui/button";
import { PageHeader } from "../../components/ui/feedback";
import { Input, NativeSelect } from "../../components/ui/input";
import { useListPage } from "../../features/admin/list";
import {
  FilterField,
  FiltersCard,
  compact,
  countActive,
  localToIso,
} from "../../features/admin/filters";
import {
  AuditRecordDialog,
  StatusCodeBadge,
} from "../../features/admin/audit-record";

type Transport = (typeof transportSchema.options)[number];
type Filters = {
  user_email?: string;
  api_key_id?: string;
  request_id?: string;
  resource_id?: string;
  action?: string;
  transport?: Transport;
  status_code?: number;
  since?: string;
  until?: string;
};
const textFields = [
  "user_email",
  "api_key_id",
  "request_id",
  "resource_id",
  "action",
] as const;
type Draft = Record<
  (typeof textFields)[number] | "status_code" | "transport" | "since" | "until",
  string
>;
const emptyDraft: Draft = {
  user_email: "",
  api_key_id: "",
  request_id: "",
  resource_id: "",
  action: "",
  status_code: "",
  transport: "",
  since: "",
  until: "",
};
function toFilters(draft: Draft): Filters {
  const { status_code, transport, since, until, ...rest } = compact(draft);
  const code = Number(status_code);
  const parsedTransport = transportSchema.safeParse(transport);
  const sinceIso = localToIso(since ?? "");
  const untilIso = localToIso(until ?? "");
  return {
    ...rest,
    ...(status_code && Number.isInteger(code) ? { status_code: code } : {}),
    ...(parsedTransport.success ? { transport: parsedTransport.data } : {}),
    ...(sinceIso ? { since: sinceIso } : {}),
    ...(untilIso ? { until: untilIso } : {}),
  };
}
const text = copy.admin.audit;
const fields = copy.app.fields;
export function AuditPage() {
  const { organization } = useWorkspace();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [record, setRecord] = useState<AuditEvent | null>(null);
  const list = useListPage<AuditEvent, (typeof auditSortKeys)[number], Filters>(
    {
      queryKey: [organization.id, "admin", "audit"],
      initialSort: "ts",
      sortKeys: auditSortKeys,
      csvName: text.csvName,
      fetchPage: async (request, signal) =>
        unwrap(
          await api.GET("/api/v1/admin/audit", {
            params: { query: { ...request, format: "json" } },
            signal,
          }),
        ),
    },
  );
  const set = (key: keyof Draft) => (value: string) => {
    setDraft((prior) => ({ ...prior, [key]: value }));
  };
  const columns = useMemo<ColumnDef<AuditEvent>[]>(
    () => [
      {
        accessorKey: "ts",
        header: fields.ts,
        size: 120,
        cell: ({ row }) => dateTime(row.original.ts),
      },
      {
        accessorKey: "action",
        header: fields.action,
        size: 130,
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.action}</span>
        ),
      },
      {
        accessorKey: "user_id",
        header: text.user,
        size: 170,
        cell: ({ row }) =>
          row.original.user_email ? (
            <span title={row.original.user_id ?? undefined}>
              {row.original.user_email}
            </span>
          ) : (
            <span className="font-mono text-xs">
              {textValue(row.original.user_id)}
            </span>
          ),
      },
      {
        accessorKey: "status_code",
        header: fields.status_code,
        size: 80,
        cell: ({ row }) => <StatusCodeBadge code={row.original.status_code} />,
      },
      {
        accessorKey: "duration_ms",
        header: fields.duration_ms,
        size: 80,
        cell: ({ row }) =>
          metricValue(row.original.duration_ms, "milliseconds"),
      },
      { accessorKey: "transport", header: fields.transport, size: 80 },
      {
        accessorKey: "api_key_id",
        header: fields.api_key_id,
        enableSorting: false,
        size: 200,
        cell: ({ getValue }) => textValue(getValue()),
      },
      {
        accessorKey: "installation_id",
        header: fields.installation_id,
        enableSorting: false,
        size: 200,
        cell: ({ getValue }) => textValue(getValue()),
      },
      {
        accessorKey: "auth_method",
        header: fields.auth_method,
        enableSorting: false,
        size: 90,
      },
      { accessorKey: "ip", header: fields.ip, enableSorting: false, size: 110 },
      {
        accessorKey: "user_agent",
        header: fields.user_agent,
        enableSorting: false,
        size: 220,
        cell: ({ getValue }) => truncate(textValue(getValue()), 60),
      },
      {
        accessorKey: "request_id",
        header: fields.request_id,
        size: 220,
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.request_id}</span>
        ),
      },
      {
        accessorKey: "resource_type",
        header: fields.resource_type,
        enableSorting: false,
        size: 100,
        cell: ({ getValue }) => textValue(getValue()),
      },
      {
        id: "resource_ids",
        accessorFn: (event) => event.resource_ids.join(" "),
        header: fields.resource_ids,
        enableSorting: false,
        size: 220,
        cell: ({ row }) =>
          row.original.resource_ids.length === 0
            ? copy.app.common.unavailable
            : truncate(
                row.original.resource_ids.join(copy.app.common.separator),
                60,
              ),
      },
      {
        id: "detail",
        accessorFn: (event) => JSON.stringify(event.detail),
        header: text.detail,
        enableSorting: false,
        size: 260,
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {truncate(JSON.stringify(row.original.detail), 80)}
          </span>
        ),
      },
    ],
    [],
  );
  const active = countActive(list.filters);
  return (
    <>
      <PageHeader title={text.title} description={text.description} />
      <FiltersCard title={text.filters} activeCount={active}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            list.setFilters(toFilters(draft));
          }}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {textFields.map((key) => (
              <FilterField
                key={key}
                label={
                  key === "resource_id"
                    ? text.resourceId
                    : key === "user_email"
                      ? text.user
                      : fields[key]
                }
                className="sm:w-auto"
              >
                {(props) => (
                  <Input
                    {...props}
                    value={draft[key]}
                    className={
                      key === "action" || key === "user_email"
                        ? ""
                        : "font-mono text-xs"
                    }
                    onChange={(event) => {
                      set(key)(event.target.value);
                    }}
                  />
                )}
              </FilterField>
            ))}
            <FilterField label={fields.status_code} className="sm:w-auto">
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  min={100}
                  max={599}
                  value={draft.status_code}
                  onChange={(event) => {
                    set("status_code")(event.target.value);
                  }}
                />
              )}
            </FilterField>
            <FilterField label={fields.transport} className="sm:w-auto">
              {(props) => (
                <NativeSelect
                  {...props}
                  value={draft.transport}
                  onChange={(event) => {
                    set("transport")(event.target.value);
                  }}
                >
                  <option value="">{copy.app.common.all}</option>
                  {transportSchema.options.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FilterField>
            <FilterField label={text.since} className="sm:w-auto">
              {(props) => (
                <Input
                  {...props}
                  type="datetime-local"
                  value={draft.since}
                  onChange={(event) => {
                    set("since")(event.target.value);
                  }}
                />
              )}
            </FilterField>
            <FilterField label={text.until} className="sm:w-auto">
              {(props) => (
                <Input
                  {...props}
                  type="datetime-local"
                  value={draft.until}
                  onChange={(event) => {
                    set("until")(event.target.value);
                  }}
                />
              )}
            </FilterField>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit">{copy.app.common.apply}</Button>
            <Button
              type="button"
              variant="ghost"
              disabled={active === 0 && countActive(draft) === 0}
              onClick={() => {
                setDraft(emptyDraft);
                list.setFilters({});
              }}
            >
              {copy.app.common.clear}
            </Button>
          </div>
        </form>
      </FiltersCard>
      <div data-testid="admin-audit-table">
        <DataTable
          {...list.table}
          columns={columns}
          label={text.title}
          compact
          hiddenColumns={[
            "api_key_id",
            "installation_id",
            "auth_method",
            "ip",
            "user_agent",
            "request_id",
            "resource_type",
            "resource_ids",
            "detail",
          ]}
          rowId={(row) => row.id}
          onRowClick={setRecord}
          emptyTitle={text.empty}
          emptyDescription={text.emptyHint}
        />
      </div>
      <AuditRecordDialog
        event={record}
        onClose={() => {
          setRecord(null);
        }}
      />
    </>
  );
}
