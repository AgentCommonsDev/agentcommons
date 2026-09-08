import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { z } from "zod";
import { Plus, RefreshCw } from "lucide-react";
import { copy } from "../copy";
import { api, unwrap } from "../lib/api/client";
import { policySortKeys, redactionRuleIds } from "../lib/api/options";
import { usePagination } from "../lib/pagination";
import { dateTime } from "../lib/display";
import type { paths } from "../lib/api/generated";
import type { Policy } from "../lib/types";
import { useWorkspace } from "../components/workspace/context";
import { DataTable } from "../components/workspace/data-table";
import { ConfirmAction } from "../components/workspace/confirm-action";
import {
  CopyButton,
  Field,
  PageHeading,
  RequestError,
  StatusBadge,
} from "../components/workspace/primitives";
import { Button } from "../components/ui/button";
type PolicyFilters = NonNullable<
  NonNullable<
    paths["/api/v1/admin/redaction/policies"]["get"]["parameters"]["query"]
  >["filters"]
>;
const ruleSchema = z.enum(redactionRuleIds);
function RuleLink({ id }: { id: string | null }) {
  const known = ruleSchema.safeParse(id);
  if (!known.success) return <>{id ?? copy.workspace.common.unavailable}</>;
  const path = known.data.split("/").map(encodeURIComponent).join("/");
  return (
    <a
      href={`https://github.com/secretlint/secretlint/blob/master/packages/${path}/README.md`}
      target="_blank"
      rel="noreferrer"
    >
      {known.data}
    </a>
  );
}
const allowedPatterns = (options: unknown) => {
  if (
    typeof options !== "object" ||
    options === null ||
    !("allows" in options) ||
    !Array.isArray(options.allows)
  )
    return "";
  return options.allows
    .filter((value): value is string => typeof value === "string")
    .join("\n");
};
export function RedactionPage({ jobId }: { jobId: string | undefined }) {
  const navigate = useNavigate({ from: "/admin/redaction" });
  const { organization } = useWorkspace();
  const client = useQueryClient();
  const pagination = usePagination("name", policySortKeys);
  const [filters, setFilters] = useState<PolicyFilters>({});
  const [filterName, setFilterName] = useState("");
  const [filterKind, setFilterKind] = useState("");
  const [filterEnabled, setFilterEnabled] = useState("");
  const [filterBuiltin, setFilterBuiltin] = useState("");
  const [editing, setEditing] = useState<Policy | "new" | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"REGEX" | "SECRETLINT_RULE">("REGEX");
  const [pattern, setPattern] = useState("");
  const [flags, setFlags] = useState("g");
  const [ruleId, setRuleId] = useState<(typeof redactionRuleIds)[number]>(
    redactionRuleIds[0],
  );
  const [allows, setAllows] = useState("");
  const [replacement, setReplacement] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [deleting, setDeleting] = useState<Policy | null>(null);
  const [rescanOpen, setRescanOpen] = useState(false);
  const job = jobId ?? null;
  const [sample, setSample] = useState("");
  const query = useQuery({
    queryKey: [
      organization.id,
      "policies",
      filters,
      pagination.cursor,
      pagination.sort,
      pagination.direction,
    ],
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET("/api/v1/admin/redaction/policies", {
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
  const progress = useQuery({
    queryKey: [organization.id, "rescan", job],
    queryFn: async ({ signal }) => {
      if (job === null) throw new Error(copy.workspace.redaction.noJob);
      return unwrap(
        await api.GET("/api/v1/admin/redaction/rescan/{id}", {
          params: { path: { id: job } },
          signal,
        }),
      );
    },
    enabled: job !== null,
    refetchInterval: (query) =>
      query.state.data?.state === "completed" ||
      query.state.data?.state === "failed"
        ? false
        : 2000,
  });
  const save = useMutation({
    mutationFn: async () => {
      const common = { name, enabled, ...(replacement ? { replacement } : {}) };
      const body =
        kind === "REGEX"
          ? { ...common, kind, pattern, flags }
          : {
              ...common,
              kind,
              ruleId,
              options: {
                allows: allows
                  .split(/\r?\n/)
                  .map((value) => value.trim())
                  .filter(Boolean),
              },
            };
      return editing && editing !== "new"
        ? unwrap(
            await api.PATCH("/api/v1/admin/redaction/policies/{id}", {
              params: { path: { id: editing.id } },
              body,
            }),
          )
        : unwrap(await api.POST("/api/v1/admin/redaction/policies", { body }));
    },
    onSuccess: async () => {
      setEditing(null);
      await client.invalidateQueries({
        queryKey: [organization.id, "policies"],
      });
    },
  });
  const test = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST("/api/v1/admin/redaction/test", {
          body: { text: sample },
        }),
      ),
  });
  const edit = (policy: Policy | "new") => {
    setEditing(policy);
    save.reset();
    setName(policy === "new" ? "" : policy.name);
    setKind(policy === "new" ? "REGEX" : policy.kind);
    setPattern(policy === "new" ? "" : (policy.pattern ?? ""));
    setFlags(policy === "new" ? "g" : (policy.flags ?? "g"));
    setRuleId(
      policy !== "new" && policy.rule_id
        ? ruleSchema.parse(policy.rule_id)
        : redactionRuleIds[0],
    );
    setAllows(policy === "new" ? "" : allowedPatterns(policy.options));
    setReplacement(policy === "new" ? "" : policy.replacement);
    setEnabled(policy === "new" || policy.enabled);
  };
  const columns = useMemo<ColumnDef<Policy>[]>(
    () => [
      { accessorKey: "name", header: copy.workspace.fields.name },
      {
        accessorKey: "kind",
        header: copy.workspace.redaction.kind,
        cell: ({ row }) => <StatusBadge value={row.original.kind} />,
      },
      {
        accessorKey: "pattern",
        header: copy.workspace.fields.pattern,
        enableSorting: false,
      },
      {
        accessorKey: "rule_id",
        header: copy.workspace.fields.rule_id,
        enableSorting: false,
        cell: ({ row }) => <RuleLink id={row.original.rule_id} />,
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
        accessorKey: "builtin",
        header: copy.workspace.fields.builtin,
        cell: ({ row }) =>
          row.original.builtin
            ? copy.workspace.common.yes
            : copy.workspace.common.no,
      },
      {
        accessorKey: "created_at",
        header: copy.workspace.fields.created_at,
        cell: ({ row }) => dateTime(row.original.created_at),
      },
      {
        accessorKey: "updated_at",
        header: copy.workspace.fields.updated_at,
        cell: ({ row }) => dateTime(row.original.updated_at),
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
                edit(row.original);
              }}
            >
              {copy.workspace.common.edit}
            </Button>
            <Button
              size="small"
              variant="ghost"
              disabled={row.original.builtin}
              onClick={() => {
                setDeleting(row.original);
              }}
            >
              {copy.workspace.redaction.delete}
            </Button>
          </div>
        ),
      },
    ],
    [edit],
  );
  return (
    <>
      <PageHeading
        title={copy.workspace.redaction.title}
        description={copy.workspace.redaction.description}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setRescanOpen(true);
              }}
            >
              <RefreshCw size={15} aria-hidden />
              {copy.workspace.redaction.rescan}
            </Button>
            <Button
              onClick={() => {
                edit("new");
              }}
            >
              <Plus size={15} aria-hidden />
              {copy.workspace.redaction.create}
            </Button>
          </>
        }
      />
      {job && (
        <div className="form-success" role="status">
          {copy.workspace.redaction.rescanStarted}
          {copy.workspace.common.separator}
          {job}
          <CopyButton value={job} />
          {progress.data && (
            <div className="rescan-progress">
              <StatusBadge value={progress.data.state} />
              <progress
                aria-label={copy.workspace.redaction.progress}
                max={Math.max(1, progress.data.total_sessions)}
                value={progress.data.processed_sessions}
              />
              <span>
                {copy.workspace.redaction.processed}{" "}
                {progress.data.processed_sessions}
                {copy.workspace.common.fractionSeparator}
                {progress.data.total_sessions}
              </span>
              <span>
                {copy.workspace.redaction.matches}{" "}
                {progress.data.redaction_count}
              </span>
              {progress.data.error && (
                <p className="form-error" role="alert">
                  {progress.data.error}
                </p>
              )}
            </div>
          )}
          {progress.error && (
            <RequestError
              error={progress.error}
              retry={() => {
                void progress.refetch();
              }}
            />
          )}
        </div>
      )}
      {editing && (
        <form
          className="workspace-panel"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <h2>
            {editing === "new"
              ? copy.workspace.redaction.create
              : copy.workspace.redaction.edit}
          </h2>
          <div className="form-grid">
            <Field
              label={copy.workspace.fields.name}
              hint={copy.workspace.redaction.nameHint}
            >
              {(props) => (
                <input
                  {...props}
                  required
                  maxLength={64}
                  value={name}
                  disabled={editing !== "new" && editing.builtin}
                  onChange={(event) => {
                    setName(event.target.value);
                  }}
                />
              )}
            </Field>
            <Field label={copy.workspace.redaction.kind}>
              {(props) => (
                <select
                  {...props}
                  value={kind}
                  onChange={(event) => {
                    if (
                      event.target.value === "REGEX" ||
                      event.target.value === "SECRETLINT_RULE"
                    )
                      setKind(event.target.value);
                  }}
                >
                  <option value="REGEX">
                    {copy.workspace.redaction.regex}
                  </option>
                  <option value="SECRETLINT_RULE">
                    {copy.workspace.redaction.secretlint}
                  </option>
                </select>
              )}
            </Field>
            {kind === "REGEX" ? (
              <>
                <Field label={copy.workspace.fields.pattern}>
                  {(props) => (
                    <input
                      {...props}
                      required
                      maxLength={1024}
                      value={pattern}
                      onChange={(event) => {
                        setPattern(event.target.value);
                      }}
                    />
                  )}
                </Field>
                <Field label={copy.workspace.fields.flags}>
                  {(props) => (
                    <input
                      {...props}
                      value={flags}
                      onChange={(event) => {
                        setFlags(event.target.value);
                      }}
                    />
                  )}
                </Field>
              </>
            ) : (
              <>
                <Field label={copy.workspace.fields.rule_id}>
                  {(props) => (
                    <select
                      {...props}
                      value={ruleId}
                      onChange={(event) => {
                        setRuleId(ruleSchema.parse(event.target.value));
                      }}
                    >
                      {redactionRuleIds.map((id) => (
                        <option key={id} value={id}>
                          {id}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <p className="policy-rule-source">
                  <RuleLink id={ruleId} />
                </p>
                <Field
                  label={copy.workspace.redaction.allows}
                  hint={copy.workspace.redaction.allowsHint}
                >
                  {(props) => (
                    <textarea
                      {...props}
                      value={allows}
                      onChange={(event) => {
                        setAllows(event.target.value);
                      }}
                    />
                  )}
                </Field>
              </>
            )}
            <Field label={copy.workspace.fields.replacement}>
              {(props) => (
                <input
                  {...props}
                  maxLength={256}
                  value={replacement}
                  onChange={(event) => {
                    setReplacement(event.target.value);
                  }}
                />
              )}
            </Field>
          </div>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => {
                setEnabled(event.target.checked);
              }}
            />
            {copy.workspace.common.enabled}
          </label>
          {save.error && <RequestError error={save.error} />}
          <div className="form-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setEditing(null);
              }}
            >
              {copy.workspace.common.cancel}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending
                ? copy.workspace.common.saving
                : copy.workspace.common.save}
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
            ...(filterName.trim() ? { name: filterName.trim() } : {}),
            ...(filterKind === "REGEX" || filterKind === "SECRETLINT_RULE"
              ? { kind: filterKind }
              : {}),
            ...(filterEnabled ? { enabled: filterEnabled === "true" } : {}),
            ...(filterBuiltin ? { builtin: filterBuiltin === "true" } : {}),
          });
          pagination.reset();
        }}
      >
        <input
          aria-label={copy.workspace.redaction.filterName}
          placeholder={copy.workspace.redaction.filterName}
          value={filterName}
          onChange={(event) => {
            setFilterName(event.target.value);
          }}
        />
        <Field label={copy.workspace.redaction.kind}>
          {(props) => (
            <select
              {...props}
              aria-label={copy.workspace.redaction.filterKind}
              value={filterKind}
              onChange={(event) => {
                setFilterKind(event.target.value);
              }}
            >
              <option value="">{copy.workspace.common.all}</option>
              <option value="REGEX">{copy.workspace.redaction.regex}</option>
              <option value="SECRETLINT_RULE">
                {copy.workspace.redaction.secretlint}
              </option>
            </select>
          )}
        </Field>
        <Field label={copy.workspace.fields.enabled}>
          {(props) => (
            <select
              {...props}
              aria-label={copy.workspace.redaction.filterEnabled}
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
        <Field label={copy.workspace.fields.builtin}>
          {(props) => (
            <select
              {...props}
              aria-label={copy.workspace.redaction.filterBuiltin}
              value={filterBuiltin}
              onChange={(event) => {
                setFilterBuiltin(event.target.value);
              }}
            >
              <option value="">{copy.workspace.common.all}</option>
              <option value="true">{copy.workspace.common.yes}</option>
              <option value="false">{copy.workspace.common.no}</option>
            </select>
          )}
        </Field>
        <Button type="submit" variant="secondary">
          {copy.workspace.common.apply}
        </Button>
      </form>
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
          label={copy.workspace.redaction.title}
          csvName={copy.workspace.redaction.csvName}
          fetchExportPage={async (cursor, signal) =>
            unwrap(
              await api.GET("/api/v1/admin/redaction/policies", {
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
      <form
        className="workspace-panel"
        onSubmit={(event) => {
          event.preventDefault();
          test.mutate();
        }}
      >
        <h2>{copy.workspace.redaction.test}</h2>
        <Field
          label={copy.workspace.redaction.testText}
          hint={copy.workspace.redaction.testHint}
        >
          {(props) => (
            <textarea
              {...props}
              value={sample}
              onChange={(event) => {
                setSample(event.target.value);
              }}
            />
          )}
        </Field>
        <Button type="submit" disabled={test.isPending}>
          {test.isPending
            ? copy.workspace.common.pending
            : copy.workspace.redaction.test}
        </Button>
        {test.error && <RequestError error={test.error} />}
        {test.data && (
          <div className="redaction-result">
            <h3>{copy.workspace.redaction.result}</h3>
            <pre>{test.data.text}</pre>
            <CopyButton value={test.data.text} />
            <h3>{copy.workspace.redaction.matches}</h3>
            {test.data.matches.length === 0 ? (
              <p>{copy.workspace.redaction.noMatches}</p>
            ) : (
              <ul>
                {test.data.matches.map((match) => (
                  <li key={match.policy_id}>
                    {match.policy_id}
                    {copy.workspace.common.separator}
                    {match.count}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </form>
      <ConfirmAction
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={copy.workspace.redaction.deleteTitle}
        description={copy.workspace.redaction.deleteDescription}
        confirmLabel={copy.workspace.redaction.delete}
        action={async (reason) => {
          if (!deleting) return;
          unwrap(
            await api.DELETE("/api/v1/admin/redaction/policies/{id}", {
              params: { path: { id: deleting.id } },
              body: { reason },
            }),
          );
          await client.invalidateQueries({
            queryKey: [organization.id, "policies"],
          });
        }}
      />
      <ConfirmAction
        open={rescanOpen}
        onOpenChange={setRescanOpen}
        title={copy.workspace.redaction.rescanTitle}
        description={copy.workspace.redaction.rescanDescription}
        confirmLabel={copy.workspace.redaction.rescan}
        action={async (reason) => {
          const result = unwrap(
            await api.POST("/api/v1/admin/redaction/rescan", {
              body: { reason },
            }),
          );
          await navigate({ search: { job: result.job_id }, replace: true });
        }}
      />
    </>
  );
}
