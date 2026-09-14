import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import type { z } from "zod";
import type * as schemas from "@agentcommons/core/schemas";
import { copy } from "../../copy";
import { api, unwrap } from "../../lib/api/client";
import { toolPolicyViolationSortKeys } from "../../lib/api/options";
import { dateTime } from "../../lib/display";
import { paths } from "../../lib/routes";
import { useWorkspace } from "../../components/app/workspace";
import { DataTable } from "../../components/app/data-table";
import { Badge } from "../../components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import {
  BooleanFilterSelect,
  EnumFilterSelect,
  FilterBar,
  compact,
  countActive,
} from "./filters";
import { useListPage } from "./list";

type Violation = z.infer<typeof schemas.toolPolicyViolationSchema>;
type Harness = z.infer<typeof schemas.harnessSchema>;
type Decision = Violation["decision"];
type Severity = NonNullable<Violation["severity"]>;
type Source = Violation["source"];

const text = copy.admin.toolPolicy;
// Mirror the core enums, whose schema module is not shipped to the browser as values.
const harnesses: readonly Harness[] = [
  "CLAUDE_CODE",
  "CODEX",
  "GEMINI_CLI",
  "PI",
];
const decisions: readonly Decision[] = ["deny", "warn", "allow"];
const severities: readonly Severity[] = ["low", "medium", "high", "critical"];
const sources: readonly Source[] = ["projection", "hook"];
const harnessLabel = (harness: Harness) => copy.app.harnesses[harness];
const decisionVariant: Record<Decision, "danger" | "warning" | "success"> = {
  deny: "danger",
  warn: "warning",
  allow: "success",
};
const severityVariant: Record<Severity, "danger" | "warning" | "neutral"> = {
  critical: "danger",
  high: "danger",
  medium: "warning",
  low: "neutral",
};
const linkClass = "font-mono text-xs text-accent hover:underline";

function SessionLink({ id }: { id: string }) {
  return (
    <Link
      to="/app/sessions/$id"
      params={{ id }}
      className={`${linkClass} break-all`}
      aria-label={`${text.openSession} ${id}`}
    >
      {id}
    </Link>
  );
}
/** The message the call landed on, deep-linked; a gate report without a sequence has none. */
function MessageLink({ violation }: { violation: Violation }) {
  if (violation.seq === null)
    return <span className="text-muted">{text.metadata}</span>;
  return (
    <Link
      to="/app/sessions/$id"
      params={{ id: violation.session_id }}
      hash={String(violation.seq)}
      className={linkClass}
    >
      {text.message(violation.seq)}
    </Link>
  );
}
/** The masked preview of the flagged command, or a dash when none was recorded. */
function Preview({ value }: { value: string | null }) {
  return (
    <span className="font-mono text-xs break-all">{value ?? text.none}</span>
  );
}
function Fingerprint({ value }: { value: string | null }) {
  if (value === null) return <span className="text-muted">{text.none}</span>;
  return (
    <span className="font-mono text-xs" title={text.fingerprintTitle(value)}>
      {value.slice(0, 12)}
    </span>
  );
}

/** The `filters` of `toolPolicyViolationsInputSchema`, as the client types them. */
type ViolationFilters = {
  session_id?: string;
  source?: Source;
  harness?: Harness;
  rule_id?: string;
  decision?: Decision;
  severity?: Severity;
  enforced?: boolean;
};
/** The search keys of `/app/admin/tool-policy` that carry the ledger's filters. */
export type ViolationSearch = Partial<
  Record<
    | "source"
    | "harness"
    | "decision"
    | "severity"
    | "enforced"
    | "session_id"
    | "rule_id",
    string | undefined
  >
>;
const idPattern =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const idExpression = new RegExp(`^${idPattern}$`);
const isId = (value: string | undefined): value is string =>
  value !== undefined && idExpression.test(value);
const firstOf = <Value extends string>(
  options: readonly Value[],
  value: string | undefined,
): Value | undefined => options.find((option) => option === value);
/** The filters a URL names; malformed values drop so a bad link shows the whole ledger. */
function filtersFromSearch(search: ViolationSearch): ViolationFilters {
  const ruleId = search.rule_id?.trim() ?? "";
  const source = firstOf(sources, search.source);
  const harness = firstOf(harnesses, search.harness);
  const decision = firstOf(decisions, search.decision);
  const severity = firstOf(severities, search.severity);
  return {
    ...(isId(search.session_id) ? { session_id: search.session_id } : {}),
    ...(source ? { source } : {}),
    ...(harness ? { harness } : {}),
    ...(decision ? { decision } : {}),
    ...(severity ? { severity } : {}),
    ...(search.enforced === "true"
      ? { enforced: true }
      : search.enforced === "false"
        ? { enforced: false }
        : {}),
    ...(ruleId && ruleId.length <= 64 ? { rule_id: ruleId } : {}),
  };
}
type Draft = Record<"session_id" | "rule_id", string>;
const draftOf = (filters: ViolationFilters): Draft => ({
  session_id: filters.session_id ?? "",
  rule_id: filters.rule_id ?? "",
});
const enforcedParam = (value: boolean | undefined) =>
  value === undefined ? undefined : value ? "true" : "false";

/**
 * The recorded tool-policy violations, newest first, with the session and message each
 * landed on. Filters live in the URL, so a filtered ledger is a link.
 */
export function ToolPolicyViolations({ search }: { search: ViolationSearch }) {
  const { organization } = useWorkspace();
  const navigate = useNavigate();
  const filters = filtersFromSearch(search);
  const [draft, setDraft] = useState<Draft>(() => draftOf(filters));
  const list = useListPage<
    Violation,
    (typeof toolPolicyViolationSortKeys)[number],
    ViolationFilters
  >({
    queryKey: [organization.id, "admin", "tool-policy", "violations"],
    initialSort: "matched_at",
    sortKeys: toolPolicyViolationSortKeys,
    csvName: text.ledgerCsvName,
    filters,
    onFiltersChange: (next) => {
      void navigate({
        to: paths.admin.toolPolicy,
        search: (previous) => ({
          ...previous,
          source: next.source,
          harness: next.harness,
          decision: next.decision,
          severity: next.severity,
          enforced: enforcedParam(next.enforced),
          session_id: next.session_id,
          rule_id: next.rule_id,
        }),
        replace: true,
      });
    },
    fetchPage: async (request, signal) =>
      unwrap(
        await api.GET("/api/v1/admin/tool-policy/violations", {
          params: { query: { ...request, format: "json" } },
          signal,
        }),
      ),
  });
  const set = (key: keyof Draft) => (value: string) => {
    setDraft((prior) => ({ ...prior, [key]: value }));
  };
  const filtered = countActive(filters) > 0;
  const columns: ColumnDef<Violation>[] = [
    {
      accessorKey: "matched_at",
      header: text.time,
      size: 140,
      cell: ({ row }) => dateTime(row.original.matched_at),
    },
    {
      accessorKey: "rule_id",
      header: text.rule,
      enableSorting: false,
      size: 170,
      cell: ({ row }) => (
        <span className="font-mono text-xs break-all">
          {row.original.rule_id ?? text.none}
        </span>
      ),
    },
    {
      accessorKey: "decision",
      header: text.decision,
      enableSorting: false,
      size: 90,
      cell: ({ row }) => (
        <Badge variant={decisionVariant[row.original.decision]}>
          {text.actions[row.original.decision]}
        </Badge>
      ),
    },
    {
      accessorKey: "severity",
      header: text.severity,
      enableSorting: false,
      size: 90,
      cell: ({ row }) =>
        row.original.severity === null ? (
          <span className="text-muted">{text.none}</span>
        ) : (
          <Badge variant={severityVariant[row.original.severity]}>
            {text.severities[row.original.severity]}
          </Badge>
        ),
    },
    {
      accessorKey: "harness",
      header: text.harnesses,
      enableSorting: false,
      size: 110,
      cell: ({ row }) => harnessLabel(row.original.harness),
    },
    {
      accessorKey: "tool",
      header: text.tool,
      enableSorting: false,
      size: 120,
      cell: ({ row }) => (
        <code className="font-mono text-xs break-all">{row.original.tool}</code>
      ),
    },
    {
      accessorKey: "masked_command",
      header: text.preview,
      enableSorting: false,
      size: 200,
      cell: ({ row }) => <Preview value={row.original.masked_command} />,
    },
    {
      accessorKey: "fingerprint",
      header: text.fingerprint,
      enableSorting: false,
      size: 120,
      cell: ({ row }) => <Fingerprint value={row.original.fingerprint} />,
    },
    {
      accessorKey: "enforced",
      header: text.enforced,
      enableSorting: false,
      size: 100,
      cell: ({ row }) => (
        <Badge variant={row.original.enforced ? "danger" : "neutral"}>
          {row.original.enforced ? text.enforcedYes : text.enforcedNo}
        </Badge>
      ),
    },
    {
      accessorKey: "source",
      header: text.source,
      enableSorting: false,
      size: 100,
      cell: ({ row }) => (
        <Badge variant={row.original.source === "hook" ? "accent" : "neutral"}>
          {text.sources[row.original.source]}
        </Badge>
      ),
    },
    {
      accessorKey: "session_id",
      header: text.session,
      enableSorting: false,
      size: 220,
      cell: ({ row }) => <SessionLink id={row.original.session_id} />,
    },
    {
      accessorKey: "seq",
      header: text.messageColumn,
      enableSorting: false,
      size: 120,
      cell: ({ row }) => <MessageLink violation={row.original} />,
    },
  ];
  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>{text.ledgerTitle}</CardTitle>
          <CardDescription>{text.ledgerDescription}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-[13px] leading-relaxed text-muted">
          {text.neverStored}
        </p>
        <div data-testid="admin-tool-policy-violations">
          <DataTable
            {...list.table}
            columns={columns}
            label={text.ledgerTitle}
            hiddenColumns={["fingerprint"]}
            rowId={(row) => row.id}
            emptyTitle={filtered ? text.noMatch : text.noViolations}
            emptyDescription={
              filtered ? text.noMatchHint : text.noViolationsHint
            }
            toolbar={
              <FilterBar
                label={text.filterLabel}
                activeCount={countActive(filters)}
                onApply={() => {
                  const { source, harness, decision, severity, enforced } =
                    filters;
                  list.setFilters({
                    ...(source === undefined ? {} : { source }),
                    ...(harness === undefined ? {} : { harness }),
                    ...(decision === undefined ? {} : { decision }),
                    ...(severity === undefined ? {} : { severity }),
                    ...(enforced === undefined ? {} : { enforced }),
                    ...compact({
                      session_id: draft.session_id.trim(),
                      rule_id: draft.rule_id.trim(),
                    }),
                  });
                }}
                onClear={() => {
                  setDraft(draftOf({}));
                  list.setFilters({});
                }}
                controls={[
                  {
                    id: "decision",
                    label: text.decision,
                    width: "sm:w-36",
                    render: (props) => (
                      <EnumFilterSelect
                        {...props}
                        value={filters.decision}
                        options={decisions}
                        optionLabel={(value) => text.actions[value]}
                        allLabel={text.allDecisions}
                        onChange={(next) => {
                          list.setFilter("decision", next);
                        }}
                      />
                    ),
                  },
                  {
                    id: "severity",
                    label: text.severity,
                    width: "sm:w-36",
                    render: (props) => (
                      <EnumFilterSelect
                        {...props}
                        value={filters.severity}
                        options={severities}
                        optionLabel={(value) => text.severities[value]}
                        allLabel={text.allSeverities}
                        onChange={(next) => {
                          list.setFilter("severity", next);
                        }}
                      />
                    ),
                  },
                  {
                    id: "harness",
                    label: text.harnesses,
                    width: "sm:w-40",
                    render: (props) => (
                      <EnumFilterSelect
                        {...props}
                        value={filters.harness}
                        options={harnesses}
                        optionLabel={harnessLabel}
                        allLabel={text.allHarnesses}
                        onChange={(next) => {
                          list.setFilter("harness", next);
                        }}
                      />
                    ),
                  },
                  {
                    id: "source",
                    label: text.source,
                    width: "sm:w-36",
                    render: (props) => (
                      <EnumFilterSelect
                        {...props}
                        value={filters.source}
                        options={sources}
                        optionLabel={(value) => text.sources[value]}
                        allLabel={text.allSources}
                        onChange={(next) => {
                          list.setFilter("source", next);
                        }}
                      />
                    ),
                  },
                  {
                    id: "enforced",
                    label: text.enforced,
                    width: "sm:w-40",
                    render: (props) => (
                      <BooleanFilterSelect
                        {...props}
                        value={filters.enforced}
                        labels={{
                          all: text.allEnforced,
                          on: text.enforcedYes,
                          off: text.enforcedNo,
                        }}
                        onChange={(next) => {
                          list.setFilter("enforced", next);
                        }}
                      />
                    ),
                  },
                  {
                    id: "session",
                    label: text.filterSession,
                    width: "sm:w-64",
                    render: (props) => (
                      <Input
                        {...props}
                        type="search"
                        className={`${props.className} font-mono text-xs`}
                        placeholder={text.filterSession}
                        pattern={idPattern}
                        title={text.idHint}
                        value={draft.session_id}
                        onChange={(event) => {
                          set("session_id")(event.target.value);
                        }}
                      />
                    ),
                  },
                  {
                    id: "rule",
                    label: text.filterRule,
                    width: "sm:w-48",
                    render: (props) => (
                      <Input
                        {...props}
                        type="search"
                        className={`${props.className} font-mono text-xs`}
                        placeholder={text.filterRule}
                        maxLength={64}
                        value={draft.rule_id}
                        onChange={(event) => {
                          set("rule_id")(event.target.value);
                        }}
                      />
                    ),
                  },
                ]}
              />
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}
