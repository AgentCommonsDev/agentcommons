import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { copy } from "../../copy";
import { api, unwrap } from "../../lib/api/client";
import { policySortKeys } from "../../lib/api/options";
import { dateTime, statusLabel, truncate } from "../../lib/display";
import { paths } from "../../lib/routes";
import type { Policy } from "../../lib/types";
import { useWorkspace } from "../../components/app/workspace";
import { DataTable } from "../../components/app/data-table";
import { ConfirmDialog } from "../../components/app/confirm-dialog";
import { StatusBadge } from "../../components/app/states";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Switch } from "../../components/ui/field";
import { PageHeader } from "../../components/ui/feedback";
import { Input } from "../../components/ui/input";
import { useListPage } from "../../features/admin/list";
import {
  BooleanFilterSelect,
  EnumFilterSelect,
  FilterBar,
  countActive,
  without,
} from "../../features/admin/filters";
import { RowMenu, actionsHeader } from "../../features/admin/row-menu";
import {
  PolicyDialog,
  RescanProgressCard,
  RuleLink,
  TestRedactionCard,
  policyBody,
  usePresetEnabled,
} from "../../features/admin/redaction";
import {
  RecentRedactions,
  RedactionSummary,
  RescanRuns,
} from "../../features/admin/redaction-activity";

type Kind = Policy["kind"];
type Filters = {
  name?: string;
  kind?: Kind;
  enabled?: boolean;
  builtin?: boolean;
};
/** Every confirmed action on this page; one dialog describes and runs them all. */
type Action =
  | { kind: "toggle"; policy: Policy }
  | { kind: "delete"; policy: Policy }
  | { kind: "rescan" };
// Mirrors core's policyKindSchema, whose module needs Node and cannot ship to the browser.
const kinds: readonly Kind[] = ["REGEX", "SECRETLINT_RULE"];
const text = copy.admin.redaction;
function describe(action: Action | null) {
  switch (action?.kind) {
    case "toggle":
      return action.policy.enabled
        ? {
            title: text.disableTitle,
            description: text.disableDescription,
            label: text.disable,
            destructive: false,
            requireReason: false,
          }
        : {
            title: text.enableTitle,
            description: text.enableDescription,
            label: text.enable,
            destructive: false,
            requireReason: false,
          };
    case "delete":
      return {
        title: text.deleteTitle,
        description: text.deleteDescription,
        label: copy.app.common.delete,
        destructive: true,
        requireReason: true,
      };
    case "rescan":
      return {
        title: text.rescanTitle,
        description: text.rescanDescription,
        label: text.rescan,
        destructive: false,
        requireReason: true,
      };
    case undefined:
      return {
        title: "",
        description: "",
        label: copy.app.common.save,
        destructive: false,
        requireReason: true,
      };
  }
}
export function RedactionPage({ jobId }: { jobId: string | undefined }) {
  const { organization } = useWorkspace();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [nameDraft, setNameDraft] = useState("");
  const [editor, setEditor] = useState<{ policy: Policy | null } | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const queryKey = [organization.id, "admin", "policies"];
  const list = useListPage<Policy, (typeof policySortKeys)[number], Filters>({
    queryKey,
    initialSort: "updated_at",
    sortKeys: policySortKeys,
    csvName: text.csvName,
    fetchPage: async (request, signal) =>
      unwrap(
        await api.GET("/api/v1/admin/redaction/policies", {
          params: { query: { ...request, format: "json" } },
          signal,
        }),
      ),
  });
  const preset = usePresetEnabled(organization.id);
  const refresh = () => client.invalidateQueries({ queryKey });
  const columns = useMemo<ColumnDef<Policy>[]>(
    () => [
      {
        accessorKey: "name",
        header: text.name,
        size: 180,
        cell: ({ row }) => (
          <span className="font-medium">{row.original.name}</span>
        ),
      },
      {
        accessorKey: "kind",
        header: text.kind,
        size: 110,
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
        size: 220,
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
        size: 80,
        cell: ({ row }) => (
          <Switch
            checked={row.original.enabled}
            aria-label={text.toggle(row.original.name)}
            onCheckedChange={() => {
              setAction({ kind: "toggle", policy: row.original });
            }}
          />
        ),
      },
      {
        accessorKey: "builtin",
        header: text.source,
        size: 90,
        cell: ({ row }) => (
          <Badge variant={row.original.builtin ? "neutral" : "accent"}>
            {row.original.builtin ? text.builtin : text.custom}
          </Badge>
        ),
      },
      {
        accessorKey: "updated_at",
        header: copy.app.common.updated,
        size: 120,
        cell: ({ row }) => dateTime(row.original.updated_at),
      },
      {
        accessorKey: "replacement",
        header: copy.app.fields.replacement,
        enableSorting: false,
        size: 150,
        cell: ({ row }) => (
          <code className="font-mono text-xs">{row.original.replacement}</code>
        ),
      },
      {
        accessorKey: "created_at",
        header: copy.app.common.created,
        size: 120,
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
                  setAction({ kind: "delete", policy: row.original });
                },
              },
            ]}
          />
        ),
      },
    ],
    [],
  );
  const confirmation = describe(action);
  // While the page watches a rescan, the ledger below refreshes with its progress.
  const live = jobId !== undefined;
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
                setAction({ kind: "rescan" });
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
              to: paths.admin.redaction,
              search: { job: undefined },
            });
          }}
        />
      )}
      <RedactionSummary live={live} />
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
              activeCount={countActive(list.filters)}
              onApply={() => {
                const rest = without(list.filters, "name");
                const name = nameDraft.trim();
                list.setFilters(name ? { ...rest, name } : rest);
              }}
              onClear={() => {
                setNameDraft("");
                list.setFilters({});
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
                    <EnumFilterSelect
                      {...props}
                      value={list.filters.kind}
                      options={kinds}
                      optionLabel={statusLabel}
                      allLabel={text.allKinds}
                      onChange={(next) => {
                        list.setFilter("kind", next);
                      }}
                    />
                  ),
                },
                {
                  id: "state",
                  label: text.filterEnabled,
                  width: "sm:w-36",
                  render: (props) => (
                    <BooleanFilterSelect
                      {...props}
                      value={list.filters.enabled}
                      labels={{
                        all: text.allStates,
                        on: copy.app.common.enabled,
                        off: copy.app.common.disabled,
                      }}
                      onChange={(next) => {
                        list.setFilter("enabled", next);
                      }}
                    />
                  ),
                },
                {
                  id: "source",
                  label: text.filterBuiltin,
                  width: "sm:w-36",
                  render: (props) => (
                    <BooleanFilterSelect
                      {...props}
                      value={list.filters.builtin}
                      labels={{
                        all: text.allSources,
                        on: text.builtin,
                        off: text.custom,
                      }}
                      onChange={(next) => {
                        list.setFilter("builtin", next);
                      }}
                    />
                  ),
                },
              ]}
            />
          }
        />
      </div>
      <RescanRuns live={live} />
      <RecentRedactions live={live} />
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
        open={action !== null}
        onOpenChange={(open) => {
          if (!open) setAction(null);
        }}
        title={confirmation.title}
        description={confirmation.description}
        confirmLabel={confirmation.label}
        destructive={confirmation.destructive}
        requireReason={confirmation.requireReason}
        action={async (reason) => {
          if (!action) return;
          switch (action.kind) {
            case "toggle":
              unwrap(
                await api.PATCH("/api/v1/admin/redaction/policies/{id}", {
                  params: { path: { id: action.policy.id } },
                  body: policyBody(action.policy, {
                    enabled: !action.policy.enabled,
                  }),
                }),
              );
              await refresh();
              return;
            case "delete":
              unwrap(
                await api.DELETE("/api/v1/admin/redaction/policies/{id}", {
                  params: { path: { id: action.policy.id } },
                  body: { reason },
                }),
              );
              await refresh();
              return;
            case "rescan": {
              const result = unwrap(
                await api.POST("/api/v1/admin/redaction/rescan", {
                  body: { reason },
                }),
              );
              await navigate({
                to: paths.admin.redaction,
                search: { job: result.job_id },
              });
            }
          }
        }}
      />
    </>
  );
}
