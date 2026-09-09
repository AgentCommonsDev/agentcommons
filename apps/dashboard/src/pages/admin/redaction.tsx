import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { copy } from "../../copy";
import { api, unwrap } from "../../lib/api/client";
import { policySortKeys } from "../../lib/api/options";
import { dateTime, truncate } from "../../lib/display";
import type { Policy } from "../../lib/types";
import { useWorkspace } from "../../components/app/workspace";
import { DataTable } from "../../components/app/data-table";
import { ConfirmDialog } from "../../components/app/confirm-dialog";
import { RequestError, StatusBadge } from "../../components/app/states";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Switch } from "../../components/ui/field";
import { PageHeader } from "../../components/ui/feedback";
import { Input, NativeSelect } from "../../components/ui/input";
import { useListPage } from "../../features/admin/list";
import { FilterBar, countActive, without } from "../../features/admin/filters";
import { RowMenu, actionsHeader } from "../../features/admin/row-menu";
import {
  PolicyDialog,
  RescanProgressCard,
  RuleLink,
  TestRedactionCard,
  policyBody,
  usePresetEnabled,
} from "../../features/admin/redaction";

type Kind = Policy["kind"];
type Filters = {
  name?: string;
  kind?: Kind;
  enabled?: boolean;
  builtin?: boolean;
};
const kinds: Kind[] = ["REGEX", "SECRETLINT_RULE"];
const text = copy.admin.redaction;
export function RedactionPage({ jobId }: { jobId: string | undefined }) {
  const { organization } = useWorkspace();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [nameDraft, setNameDraft] = useState("");
  const [filters, setFilters] = useState<Filters>({});
  const [editor, setEditor] = useState<{ policy: Policy | null } | null>(null);
  const [toggling, setToggling] = useState<Policy | null>(null);
  const [deleting, setDeleting] = useState<Policy | null>(null);
  const [rescanOpen, setRescanOpen] = useState(false);
  const queryKey = [organization.id, "admin", "policies"];
  const list = useListPage<Policy, (typeof policySortKeys)[number]>({
    queryKey: [...queryKey, filters],
    initialSort: "updated_at",
    sortKeys: policySortKeys,
    csvName: text.csvName,
    fetchPage: async (request, signal) =>
      unwrap(
        await api.GET("/api/v1/admin/redaction/policies", {
          params: { query: { filters, ...request, format: "json" } },
          signal,
        }),
      ),
  });
  const preset = usePresetEnabled(organization.id);
  const refresh = () => client.invalidateQueries({ queryKey });
  const update = (next: Filters) => {
    setFilters(next);
    list.reset();
  };
  const columns = useMemo<ColumnDef<Policy>[]>(
    () => [
      {
        accessorKey: "name",
        header: text.name,
        cell: ({ row }) => (
          <span className="font-medium">{row.original.name}</span>
        ),
      },
      {
        accessorKey: "kind",
        header: text.kind,
        cell: ({ row }) => <StatusBadge value={row.original.kind} />,
      },
      {
        id: "definition",
        accessorFn: (policy) =>
          policy.kind === "REGEX"
            ? (policy.pattern ?? "")
            : (policy.rule_id ?? ""),
        header: copy.app.fields.pattern,
        enableSorting: false,
        cell: ({ row }) =>
          row.original.kind === "REGEX" ? (
            <code className="font-mono text-xs break-all">
              {truncate(row.original.pattern ?? "", 56)}
            </code>
          ) : (
            <RuleLink id={row.original.rule_id} />
          ),
      },
      {
        accessorKey: "enabled",
        header: text.enabled,
        cell: ({ row }) => (
          <Switch
            checked={row.original.enabled}
            aria-label={text.toggle(row.original.name)}
            onCheckedChange={() => {
              setToggling(row.original);
            }}
          />
        ),
      },
      {
        accessorKey: "builtin",
        header: text.source,
        cell: ({ row }) => (
          <Badge variant={row.original.builtin ? "neutral" : "accent"}>
            {row.original.builtin ? text.builtin : text.custom}
          </Badge>
        ),
      },
      {
        accessorKey: "updated_at",
        header: copy.app.common.updated,
        cell: ({ row }) => dateTime(row.original.updated_at),
      },
      {
        accessorKey: "replacement",
        header: copy.app.fields.replacement,
        enableSorting: false,
        cell: ({ row }) => (
          <code className="font-mono text-xs">{row.original.replacement}</code>
        ),
      },
      {
        accessorKey: "created_at",
        header: copy.app.common.created,
        cell: ({ row }) => dateTime(row.original.created_at),
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
                label: copy.app.common.edit,
                icon: Pencil,
                onSelect: () => {
                  setEditor({ policy: row.original });
                },
              },
              {
                label: text.delete,
                icon: Trash2,
                destructive: true,
                disabled: row.original.builtin,
                onSelect: () => {
                  setDeleting(row.original);
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
      <PageHeader
        title={text.title}
        description={text.description}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setRescanOpen(true);
              }}
            >
              <RefreshCw aria-hidden />
              {text.rescan}
            </Button>
            <Button
              data-testid="admin-redaction-add"
              onClick={() => {
                setEditor({ policy: null });
              }}
            >
              <Plus aria-hidden />
              {text.add}
            </Button>
          </>
        }
      />
      {jobId && (
        <RescanProgressCard
          organizationId={organization.id}
          jobId={jobId}
          onDismiss={() => {
            void navigate({
              to: "/app/admin/redaction",
              search: { job: undefined },
            });
          }}
        />
      )}
      {list.query.error ? (
        <RequestError
          error={list.query.error}
          retry={() => {
            void list.query.refetch();
          }}
        />
      ) : (
        <div data-testid="admin-redaction-table">
          <DataTable
            {...list.table}
            columns={columns}
            label={text.title}
            hiddenColumns={["replacement", "created_at"]}
            rowId={(row) => row.id}
            emptyTitle={text.empty}
            emptyDescription={text.emptyHint}
            toolbar={
              <FilterBar
                label={copy.app.common.filters}
                activeCount={countActive(filters)}
                onApply={() => {
                  const rest = without(filters, "name");
                  const name = nameDraft.trim();
                  update(name ? { ...rest, name } : rest);
                }}
                onClear={() => {
                  setNameDraft("");
                  update({});
                }}
                controls={[
                  {
                    id: "name",
                    label: text.filterName,
                    width: "sm:w-48",
                    render: (props) => (
                      <Input
                        {...props}
                        type="search"
                        placeholder={text.filterName}
                        value={nameDraft}
                        onChange={(event) => {
                          setNameDraft(event.target.value);
                        }}
                      />
                    ),
                  },
                  {
                    id: "kind",
                    label: text.filterKind,
                    width: "sm:w-40",
                    render: (props) => (
                      <NativeSelect
                        {...props}
                        value={filters.kind ?? ""}
                        onChange={(event) => {
                          const rest = without(filters, "kind");
                          const kind = kinds.find(
                            (value) => value === event.target.value,
                          );
                          update(kind ? { ...rest, kind } : rest);
                        }}
                      >
                        <option value="">{text.allKinds}</option>
                        {kinds.map((kind) => (
                          <option key={kind} value={kind}>
                            {copy.app.statuses[kind]}
                          </option>
                        ))}
                      </NativeSelect>
                    ),
                  },
                  {
                    id: "state",
                    label: text.filterEnabled,
                    width: "sm:w-36",
                    render: (props) => (
                      <NativeSelect
                        {...props}
                        value={
                          filters.enabled === undefined
                            ? ""
                            : filters.enabled
                              ? "on"
                              : "off"
                        }
                        onChange={(event) => {
                          const rest = without(filters, "enabled");
                          update(
                            event.target.value
                              ? {
                                  ...rest,
                                  enabled: event.target.value === "on",
                                }
                              : rest,
                          );
                        }}
                      >
                        <option value="">{text.allStates}</option>
                        <option value="on">{copy.app.common.enabled}</option>
                        <option value="off">{copy.app.common.disabled}</option>
                      </NativeSelect>
                    ),
                  },
                  {
                    id: "source",
                    label: text.filterBuiltin,
                    width: "sm:w-36",
                    render: (props) => (
                      <NativeSelect
                        {...props}
                        value={
                          filters.builtin === undefined
                            ? ""
                            : filters.builtin
                              ? "builtin"
                              : "custom"
                        }
                        onChange={(event) => {
                          const rest = without(filters, "builtin");
                          update(
                            event.target.value
                              ? {
                                  ...rest,
                                  builtin: event.target.value === "builtin",
                                }
                              : rest,
                          );
                        }}
                      >
                        <option value="">{text.allSources}</option>
                        <option value="builtin">{text.builtin}</option>
                        <option value="custom">{text.custom}</option>
                      </NativeSelect>
                    ),
                  },
                ]}
              />
            }
          />
        </div>
      )}
      <TestRedactionCard policies={list.items} />
      <PolicyDialog
        open={editor !== null}
        policy={editor?.policy ?? null}
        presetEnabled={preset.data ?? true}
        onOpenChange={(open) => {
          if (!open) setEditor(null);
        }}
        onSaved={refresh}
      />
      <ConfirmDialog
        open={toggling !== null}
        onOpenChange={(open) => {
          if (!open) setToggling(null);
        }}
        title={toggling?.enabled ? text.disableTitle : text.enableTitle}
        description={
          toggling?.enabled ? text.disableDescription : text.enableDescription
        }
        confirmLabel={toggling?.enabled ? text.disable : text.enable}
        destructive={false}
        requireReason={false}
        action={async () => {
          if (!toggling) return;
          unwrap(
            await api.PATCH("/api/v1/admin/redaction/policies/{id}", {
              params: { path: { id: toggling.id } },
              body: policyBody(toggling, { enabled: !toggling.enabled }),
            }),
          );
          await refresh();
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={text.deleteTitle}
        description={text.deleteDescription}
        confirmLabel={copy.app.common.delete}
        action={async (reason) => {
          if (!deleting) return;
          unwrap(
            await api.DELETE("/api/v1/admin/redaction/policies/{id}", {
              params: { path: { id: deleting.id } },
              body: { reason },
            }),
          );
          await refresh();
        }}
      />
      <ConfirmDialog
        open={rescanOpen}
        onOpenChange={setRescanOpen}
        title={text.rescanTitle}
        description={text.rescanDescription}
        confirmLabel={text.rescan}
        destructive={false}
        action={async (reason) => {
          const result = unwrap(
            await api.POST("/api/v1/admin/redaction/rescan", {
              body: { reason },
            }),
          );
          await navigate({
            to: "/app/admin/redaction",
            search: { job: result.job_id },
          });
        }}
      />
    </>
  );
}
