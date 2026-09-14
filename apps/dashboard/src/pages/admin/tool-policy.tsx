import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { copy } from "../../copy";
import { api, unwrap } from "../../lib/api/client";
import { dateTime, errorMessage } from "../../lib/display";
import { useWorkspace } from "../../components/app/workspace";
import { DataTable } from "../../components/app/data-table";
import { ConfirmDialog } from "../../components/app/confirm-dialog";
import { QueryState } from "../../components/app/states";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { Switch } from "../../components/ui/field";
import { Alert, PageHeader } from "../../components/ui/feedback";
import { RowMenu, actionsHeader } from "../../features/admin/row-menu";
import {
  RuleDialog,
  missingPresetRules,
  type ToolPolicyDocument,
  type ToolPolicyRule,
} from "../../features/admin/tool-policy";
import {
  ToolPolicyViolations,
  type ViolationSearch,
} from "../../features/admin/tool-policy-violations";

const text = copy.admin.toolPolicy;
const severityVariant: Record<
  ToolPolicyRule["severity"],
  "danger" | "warning" | "neutral"
> = {
  critical: "danger",
  high: "danger",
  medium: "warning",
  low: "neutral",
};
const decisionVariant: Record<
  ToolPolicyRule["action"],
  "danger" | "warning" | "success"
> = { deny: "danger", warn: "warning", allow: "success" };

/** The harness set as a short label; an empty set matches every harness. */
function harnessSummary(
  harnesses: readonly ToolPolicyRule["harnesses"][number][],
) {
  return harnesses.length === 0
    ? text.anyHarness
    : harnesses.map((harness) => copy.app.harnesses[harness]).join(", ");
}

export function ToolPolicyPage({
  violationSearch,
}: {
  violationSearch: ViolationSearch;
}) {
  const { organization } = useWorkspace();
  const client = useQueryClient();
  const [editor, setEditor] = useState<{ rule: ToolPolicyRule | null } | null>(
    null,
  );
  const [removing, setRemoving] = useState<ToolPolicyRule | null>(null);
  const queryKey = [organization.id, "admin", "tool-policy"];
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET("/api/v1/admin/tool-policy", { signal })),
  });
  const refresh = () => client.invalidateQueries({ queryKey });
  // One mutation replaces the whole policy: the toggle, a removal and a preset restore all
  // send {enabled, rules}. The rule editor sends its own PUT so it can surface a 400 inline.
  const replace = useMutation({
    mutationFn: async (next: ToolPolicyDocument) =>
      unwrap(
        await api.PUT("/api/v1/admin/tool-policy", {
          body: { enabled: next.enabled, rules: next.rules },
        }),
      ),
    onSuccess: refresh,
  });
  const columns: ColumnDef<ToolPolicyRule>[] = [
    {
      accessorKey: "id",
      header: text.ruleId,
      size: 180,
      cell: ({ row }) => (
        <span className="font-mono text-xs break-all">{row.original.id}</span>
      ),
    },
    {
      accessorKey: "harnesses",
      header: text.harnesses,
      size: 130,
      cell: ({ row }) => harnessSummary(row.original.harnesses),
    },
    {
      accessorKey: "tool",
      header: text.tool,
      size: 100,
      cell: ({ row }) => (
        <code className="font-mono text-xs break-all">{row.original.tool}</code>
      ),
    },
    {
      id: "patterns",
      header: text.patternsColumn,
      size: 220,
      cell: ({ row }) =>
        row.original.command_patterns.length === 0 ? (
          <span className="text-muted">{text.noPatterns}</span>
        ) : (
          <div className="flex flex-col gap-1">
            {row.original.command_patterns.map((pattern, index) => (
              <code key={index} className="font-mono text-xs break-all">
                {pattern.value}
              </code>
            ))}
          </div>
        ),
    },
    {
      accessorKey: "action",
      header: text.action,
      size: 80,
      cell: ({ row }) => (
        <Badge variant={decisionVariant[row.original.action]}>
          {text.actions[row.original.action]}
        </Badge>
      ),
    },
    {
      accessorKey: "severity",
      header: text.severity,
      size: 90,
      cell: ({ row }) => (
        <Badge variant={severityVariant[row.original.severity]}>
          {text.severities[row.original.severity]}
        </Badge>
      ),
    },
    {
      accessorKey: "description",
      header: text.descriptionLabel,
      size: 260,
      cell: ({ row }) => row.original.description ?? text.none,
    },
    {
      id: "actions",
      header: actionsHeader,
      enableHiding: false,
      cell: ({ row }) => (
        <RowMenu
          label={copy.app.common.actions}
          items={[
            {
              label: copy.app.common.edit,
              icon: Pencil,
              onSelect: () => {
                setEditor({ rule: row.original });
              },
            },
            {
              label: text.remove,
              icon: Trash2,
              destructive: true,
              onSelect: () => {
                setRemoving(row.original);
              },
            },
          ]}
        />
      ),
    },
  ];
  return (
    <>
      <PageHeader title={text.title} description={text.description} />
      <QueryState query={query} rows={3}>
        {(document) => {
          const missing = missingPresetRules(document.rules);
          const restore = () => {
            void refresh();
          };
          return (
            <>
              <Card data-testid="admin-tool-policy-settings">
                <CardHeader>
                  <div className="min-w-0">
                    <CardTitle>{text.enforcement}</CardTitle>
                  </div>
                  <Badge variant={document.enabled ? "success" : "neutral"}>
                    {document.enabled ? text.on : text.off}
                  </Badge>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <div className="flex items-start gap-3">
                    <Switch
                      data-testid="admin-tool-policy-enabled"
                      checked={document.enabled}
                      aria-label={text.enabledLabel}
                      disabled={replace.isPending}
                      onCheckedChange={(checked) => {
                        replace.mutate({
                          enabled: checked,
                          rules: document.rules,
                        });
                      }}
                    />
                    <div className="flex flex-col gap-0.5">
                      <p className="text-sm font-medium">{text.enabledLabel}</p>
                      <p className="text-xs text-muted">{text.enabledHint}</p>
                    </div>
                  </div>
                  {replace.error && (
                    <Alert variant="danger">
                      {errorMessage(replace.error)}
                    </Alert>
                  )}
                  <p className="text-xs text-subtle">
                    {copy.app.common.updated}
                    {copy.app.common.separator}
                    {dateTime(document.updated_at)}
                  </p>
                </CardContent>
              </Card>
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-[15px] leading-tight font-semibold">
                      {text.rules}
                    </h2>
                    <p className="mt-1 text-[13px] leading-relaxed text-muted">
                      {text.rulesDescription}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <RowMenu
                      label={text.restore}
                      showLabel
                      items={
                        missing.length === 0
                          ? [{ label: text.restoreNone, disabled: true }]
                          : missing.map((rule) => ({
                              label: rule.id,
                              icon: RotateCcw,
                              onSelect: () => {
                                replace.mutate(
                                  {
                                    enabled: document.enabled,
                                    rules: [...document.rules, rule],
                                  },
                                  { onSuccess: restore },
                                );
                              },
                            }))
                      }
                    />
                    <Button
                      data-testid="admin-tool-policy-add"
                      onClick={() => {
                        setEditor({ rule: null });
                      }}
                    >
                      <Plus aria-hidden />
                      {text.add}
                    </Button>
                  </div>
                </div>
                <div data-testid="admin-tool-policy-rules">
                  <DataTable
                    data={document.rules}
                    columns={columns}
                    label={text.rules}
                    rowId={(row) => row.id}
                    emptyTitle={text.empty}
                    emptyDescription={text.emptyHint}
                  />
                </div>
              </div>
              <RuleDialog
                open={editor !== null}
                rule={editor?.rule ?? null}
                document={document}
                onOpenChange={(open) => {
                  if (!open) setEditor(null);
                }}
                onSaved={refresh}
              />
              <ConfirmDialog
                open={removing !== null}
                onOpenChange={(open) => {
                  if (!open) setRemoving(null);
                }}
                title={text.removeTitle}
                description={text.removeDescription}
                confirmLabel={text.remove}
                destructive
                requireReason={false}
                action={async () => {
                  if (!removing) return;
                  await replace.mutateAsync({
                    enabled: document.enabled,
                    rules: document.rules.filter(
                      (rule) => rule.id !== removing.id,
                    ),
                  });
                }}
              />
            </>
          );
        }}
      </QueryState>
      <ToolPolicyViolations search={violationSearch} />
    </>
  );
}
