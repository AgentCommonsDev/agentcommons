import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { ExternalLink } from "lucide-react";
import type { z } from "zod";
import {
  harnessSchema,
  visibilitySchema,
} from "@agentcommons/core/schemas/common";
import { copy } from "../../copy";
import { api, unwrap } from "../../lib/api/client";
import { moderationSortKeys } from "../../lib/api/options";
import {
  counted,
  dateTime,
  harnessLabel,
  number,
  statusLabel,
  textValue,
} from "../../lib/display";
import type { Page } from "../../lib/types";
import { useWorkspace } from "../../components/app/workspace";
import { DataTable } from "../../components/app/data-table";
import { StatusBadge } from "../../components/app/states";
import { PageHeader, Skeleton } from "../../components/ui/feedback";
import { Input } from "../../components/ui/input";
import { useListPage } from "../../features/admin/list";
import {
  BooleanFilterSelect,
  EnumFilterSelect,
  FilterBar,
  countActive,
  dateToIso,
} from "../../features/admin/filters";
import {
  ModerationDialog,
  PublicationBadge,
  moderationItems,
  type ModerationAction,
  type ModerationSession,
} from "../../features/admin/moderation";
import { RowMenu, actionsHeader } from "../../features/admin/row-menu";
import { SessionStatusBadge } from "../../features/sessions/session-header";

type Harness = z.infer<typeof harnessSchema>;
type Visibility = z.infer<typeof visibilitySchema>;
/** The API's `filters` plus `roots_only`, flat so the list hook counts every applied one. */
type Filters = {
  user_email?: string;
  harness?: Harness;
  visibility?: Visibility;
  purged?: boolean;
  published?: boolean;
  since?: string;
  until?: string;
  roots_only?: boolean;
};
type Draft = {
  user: string;
  harness: Harness | undefined;
  visibility: Visibility | undefined;
  purged: boolean | undefined;
  published: boolean | undefined;
  scope: "roots" | undefined;
  since: string;
  until: string;
};
type ModerationPage = Page<ModerationSession> & {
  total: { sessions: number };
};
const emptyDraft: Draft = {
  user: "",
  harness: undefined,
  visibility: undefined,
  purged: undefined,
  published: undefined,
  scope: undefined,
  since: "",
  until: "",
};
function toFilters(draft: Draft): Filters {
  const user = draft.user.trim();
  return {
    ...(user ? { user_email: user } : {}),
    ...(draft.harness ? { harness: draft.harness } : {}),
    ...(draft.visibility ? { visibility: draft.visibility } : {}),
    ...(draft.purged === undefined ? {} : { purged: draft.purged }),
    ...(draft.published === undefined ? {} : { published: draft.published }),
    ...(draft.since ? { since: dateToIso(draft.since) } : {}),
    ...(draft.until ? { until: dateToIso(draft.until) } : {}),
    ...(draft.scope === "roots" ? { roots_only: true } : {}),
  };
}
const text = copy.admin.moderation;
const fields = copy.app.fields;
/** "128 sessions" over every session the filters match, from the page response itself. */
function Total({
  total,
  pending,
}: {
  total: number | undefined;
  pending: boolean;
}) {
  if (pending) return <Skeleton className="h-4 w-28" />;
  if (total === undefined) return null;
  return (
    <p
      data-testid="moderation-total"
      className="text-sm text-muted tabular-nums"
    >
      {counted(total, text.total.one, text.total.many)}
    </p>
  );
}
/**
 * Every session the organization holds, from control rather than the published read
 * model, so sessions that are private, purged or not yet published are listed with
 * that state in the open.
 */
export function ModerationPage() {
  const { organization } = useWorkspace();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [action, setAction] = useState<ModerationAction | null>(null);
  const list = useListPage<
    ModerationSession,
    (typeof moderationSortKeys)[number],
    Filters,
    ModerationPage
  >({
    queryKey: [organization.id, "admin", "moderation"],
    initialSort: "started_at",
    sortKeys: moderationSortKeys,
    csvName: text.csvName,
    fetchPage: async (
      { filters: { roots_only = false, ...filters }, ...request },
      signal,
    ) =>
      unwrap(
        await api.GET("/api/v1/admin/sessions", {
          params: {
            query: { ...request, filters, roots_only, format: "json" },
          },
          signal,
        }),
      ),
  });
  const set =
    <K extends keyof Draft>(key: K) =>
    (value: Draft[K]) => {
      setDraft((prior) => ({ ...prior, [key]: value }));
    };
  const columns = useMemo<ColumnDef<ModerationSession>[]>(
    () => [
      {
        id: "title",
        accessorFn: (row) =>
          row.title?.trim() ||
          (row.published ? copy.app.common.untitledSession : text.notPublished),
        header: fields.title,
        enableSorting: false,
        size: 240,
        cell: ({ row, getValue }) => (
          <span
            className={
              row.original.title?.trim()
                ? "line-clamp-2 font-medium"
                : "line-clamp-2 text-muted"
            }
          >
            {getValue<string>()}
          </span>
        ),
      },
      {
        accessorKey: "user_email",
        header: fields.user_email,
        size: 170,
        cell: ({ getValue }) => textValue(getValue()),
      },
      {
        accessorKey: "harness",
        header: fields.harness,
        size: 100,
        cell: ({ row }) => harnessLabel(row.original.harness),
      },
      {
        accessorKey: "started_at",
        header: fields.started_at,
        size: 120,
        cell: ({ row }) => dateTime(row.original.started_at),
      },
      {
        accessorKey: "status",
        header: fields.status,
        size: 90,
        cell: ({ row }) => (
          <SessionStatusBadge
            status={row.original.status}
            purged={row.original.purged_at !== null}
          />
        ),
      },
      {
        accessorKey: "visibility",
        header: fields.visibility,
        size: 90,
        cell: ({ row }) => <StatusBadge value={row.original.visibility} />,
      },
      {
        accessorKey: "purged_at",
        header: fields.purged_at,
        size: 120,
        cell: ({ row }) => dateTime(row.original.purged_at),
      },
      {
        id: "published",
        accessorFn: (row) =>
          text.publication[row.published ? "published" : row.projection_state],
        header: text.published.label,
        enableSorting: false,
        size: 110,
        cell: ({ row }) => <PublicationBadge session={row.original} />,
      },
      {
        id: "parent",
        accessorFn: (row) =>
          row.parent_relation ? statusLabel(row.parent_relation) : text.root,
        header: text.parent,
        enableSorting: false,
        size: 90,
        cell: ({ row }) =>
          row.original.parent_relation ? (
            <StatusBadge value={row.original.parent_relation} />
          ) : (
            text.root
          ),
      },
      {
        accessorKey: "installation_hostname",
        header: fields.installation_hostname,
        enableSorting: false,
        size: 140,
        cell: ({ getValue }) => textValue(getValue()),
      },
      {
        accessorKey: "repo_name",
        header: fields.repo_name,
        enableSorting: false,
        size: 170,
        cell: ({ getValue }) => textValue(getValue()),
      },
      {
        accessorKey: "message_count",
        header: fields.message_count,
        enableSorting: false,
        size: 80,
        cell: ({ row }) => number(row.original.message_count),
      },
      {
        accessorKey: "session_id",
        header: fields.session_id,
        enableSorting: false,
        size: 220,
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.session_id}</span>
        ),
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
                label: text.open,
                icon: ExternalLink,
                link: {
                  to: "/app/sessions/$id",
                  params: { id: row.original.session_id },
                },
              },
              ...moderationItems(row.original, setAction),
            ]}
          />
        ),
      },
    ],
    [],
  );
  return (
    <>
      <PageHeader title={text.title} description={text.description} />
      <div data-testid="admin-moderation-table">
        <DataTable
          {...list.table}
          columns={columns}
          label={text.title}
          hiddenColumns={[
            "installation_hostname",
            "repo_name",
            "message_count",
            "session_id",
          ]}
          rowId={(row) => row.session_id}
          onRowClick={(row) => {
            void navigate({
              to: "/app/sessions/$id",
              params: { id: row.session_id },
            });
          }}
          emptyTitle={text.empty}
          emptyDescription={text.emptyHint}
          toolbar={
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <FilterBar
                label={copy.app.common.filters}
                activeCount={countActive(list.filters)}
                onApply={() => {
                  list.setFilters(toFilters(draft));
                }}
                onClear={() => {
                  setDraft(emptyDraft);
                  list.setFilters({});
                }}
                controls={[
                  {
                    id: "user",
                    label: text.user,
                    width: "sm:w-52",
                    render: (props) => (
                      <Input
                        {...props}
                        type="email"
                        placeholder={text.user}
                        value={draft.user}
                        onChange={(event) => {
                          set("user")(event.target.value);
                        }}
                      />
                    ),
                  },
                  {
                    id: "harness",
                    label: text.harness,
                    width: "sm:w-40",
                    render: (props) => (
                      <EnumFilterSelect
                        {...props}
                        value={draft.harness}
                        options={harnessSchema.options}
                        optionLabel={harnessLabel}
                        allLabel={text.allHarnesses}
                        onChange={set("harness")}
                      />
                    ),
                  },
                  {
                    id: "visibility",
                    label: text.visibility,
                    width: "sm:w-44",
                    render: (props) => (
                      <EnumFilterSelect
                        {...props}
                        value={draft.visibility}
                        options={visibilitySchema.options}
                        optionLabel={statusLabel}
                        allLabel={text.allVisibility}
                        onChange={set("visibility")}
                      />
                    ),
                  },
                  {
                    id: "purged",
                    label: text.purged.label,
                    width: "sm:w-40",
                    render: (props) => (
                      <BooleanFilterSelect
                        {...props}
                        value={draft.purged}
                        labels={text.purged}
                        onChange={set("purged")}
                      />
                    ),
                  },
                  {
                    id: "published",
                    label: text.published.label,
                    width: "sm:w-44",
                    render: (props) => (
                      <BooleanFilterSelect
                        {...props}
                        value={draft.published}
                        labels={text.published}
                        onChange={set("published")}
                      />
                    ),
                  },
                  {
                    id: "scope",
                    label: text.scope.label,
                    width: "sm:w-48",
                    render: (props) => (
                      <EnumFilterSelect
                        {...props}
                        value={draft.scope}
                        options={["roots"] as const}
                        optionLabel={() => text.scope.roots}
                        allLabel={text.scope.all}
                        onChange={set("scope")}
                      />
                    ),
                  },
                  {
                    id: "since",
                    label: text.since,
                    width: "sm:w-40",
                    showLabel: true,
                    render: (props) => (
                      <Input
                        {...props}
                        type="date"
                        title={text.since}
                        value={draft.since}
                        onChange={(event) => {
                          set("since")(event.target.value);
                        }}
                      />
                    ),
                  },
                  {
                    id: "until",
                    label: text.until,
                    width: "sm:w-40",
                    showLabel: true,
                    render: (props) => (
                      <Input
                        {...props}
                        type="date"
                        title={text.until}
                        value={draft.until}
                        onChange={(event) => {
                          set("until")(event.target.value);
                        }}
                      />
                    ),
                  },
                ]}
              />
              <Total
                total={list.query.data?.total.sessions}
                pending={list.query.isPending}
              />
            </div>
          }
        />
      </div>
      <ModerationDialog
        action={action}
        onClose={() => {
          setAction(null);
        }}
      />
    </>
  );
}
