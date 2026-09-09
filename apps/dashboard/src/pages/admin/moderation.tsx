import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Eye, EyeOff, ExternalLink, Trash2 } from "lucide-react";
import { copy } from "../../copy";
import { api, unwrap } from "../../lib/api/client";
import { sessionSortKeys } from "../../lib/api/options";
import { dateTime, harnessLabel, number } from "../../lib/display";
import { paths } from "../../lib/routes";
import type { SessionItem } from "../../lib/types";
import { useWorkspace } from "../../components/app/workspace";
import { DataTable } from "../../components/app/data-table";
import { ConfirmDialog } from "../../components/app/confirm-dialog";
import { RequestError, StatusBadge } from "../../components/app/states";
import { Alert, PageHeader } from "../../components/ui/feedback";
import { Input } from "../../components/ui/input";
import { useListPage } from "../../features/admin/list";
import {
  FilterBar,
  countActive,
  dateToIso,
} from "../../features/admin/filters";
import { RowMenu, actionsHeader } from "../../features/admin/row-menu";

type Filters = {
  repo_name?: string;
  user_email?: string;
  since?: string;
  until?: string;
};
type Draft = { repo: string; user: string; since: string; until: string };
type Action =
  | {
      session: SessionItem;
      kind: "visibility";
      visibility: "PUBLIC" | "PRIVATE";
    }
  | { session: SessionItem; kind: "purge" };
const emptyDraft: Draft = { repo: "", user: "", since: "", until: "" };
function toFilters(draft: Draft): Filters {
  const repo = draft.repo.trim();
  const user = draft.user.trim();
  return {
    ...(repo ? { repo_name: repo } : {}),
    ...(user ? { user_email: user } : {}),
    ...(draft.since ? { since: dateToIso(draft.since) } : {}),
    ...(draft.until ? { until: dateToIso(draft.until) } : {}),
  };
}
const text = copy.admin.moderation;
const fields = copy.app.fields;
export function ModerationPage() {
  const { organization } = useWorkspace();
  const client = useQueryClient();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [filters, setFilters] = useState<Filters>({});
  const [action, setAction] = useState<Action | null>(null);
  const list = useListPage<SessionItem, (typeof sessionSortKeys)[number]>({
    queryKey: [organization.id, "admin", "moderation", filters],
    initialSort: "started_at",
    sortKeys: sessionSortKeys,
    csvName: text.csvName,
    fetchPage: async (request, signal) =>
      unwrap(
        await api.GET("/api/v1/sessions", {
          params: { query: { filters, ...request, format: "json" } },
          signal,
        }),
      ),
  });
  const set = (key: keyof Draft) => (value: string) => {
    setDraft((prior) => ({ ...prior, [key]: value }));
  };
  const columns = useMemo<ColumnDef<SessionItem>[]>(
    () => [
      {
        accessorKey: "title",
        header: fields.title,
        cell: ({ row }) => (
          <span className="line-clamp-2 max-w-md font-medium">
            {row.original.title?.trim() || text.untitled}
          </span>
        ),
      },
      { accessorKey: "user_email", header: fields.user_email },
      {
        accessorKey: "repo_name",
        header: fields.repo_name,
        cell: ({ row }) =>
          row.original.repo_name ?? copy.app.common.unavailable,
      },
      {
        accessorKey: "harness",
        header: fields.harness,
        cell: ({ row }) => harnessLabel(row.original.harness),
      },
      {
        accessorKey: "started_at",
        header: fields.started_at,
        cell: ({ row }) => (
          <span className="whitespace-nowrap">
            {dateTime(row.original.started_at)}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: fields.status,
        cell: ({ row }) => <StatusBadge value={row.original.status} />,
      },
      {
        accessorKey: "visibility",
        header: fields.visibility,
        enableSorting: false,
        cell: ({ row }) => (
          <StatusBadge
            value={row.original.purged_at ? "PURGED" : row.original.visibility}
          />
        ),
      },
      {
        accessorKey: "message_count",
        header: fields.message_count,
        cell: ({ row }) => number(row.original.message_count),
      },
      {
        accessorKey: "branch",
        header: fields.branch,
        cell: ({ row }) => row.original.branch ?? copy.app.common.unavailable,
      },
      {
        accessorKey: "session_id",
        header: fields.session_id,
        enableSorting: false,
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.session_id}</span>
        ),
      },
      {
        id: "actions",
        header: actionsHeader,
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const session = row.original;
          return (
            <RowMenu
              label={copy.app.common.actions}
              items={[
                {
                  label: text.open,
                  icon: ExternalLink,
                  href: paths.session(session.session_id),
                },
                {
                  label: text.visible,
                  icon: Eye,
                  disabled:
                    session.purged_at !== null ||
                    session.visibility === "PUBLIC",
                  onSelect: () => {
                    setAction({
                      session,
                      kind: "visibility",
                      visibility: "PUBLIC",
                    });
                  },
                },
                {
                  label: text.private,
                  icon: EyeOff,
                  disabled:
                    session.purged_at !== null ||
                    session.visibility === "PRIVATE",
                  onSelect: () => {
                    setAction({
                      session,
                      kind: "visibility",
                      visibility: "PRIVATE",
                    });
                  },
                },
                {
                  label: text.purge,
                  icon: Trash2,
                  destructive: true,
                  disabled: session.purged_at !== null,
                  onSelect: () => {
                    setAction({ session, kind: "purge" });
                  },
                },
              ]}
            />
          );
        },
      },
    ],
    [],
  );
  const confirmation =
    action?.kind === "purge"
      ? {
          title: text.purgeTitle,
          description: text.purgeDescription,
          label: text.purge,
        }
      : action?.visibility === "PRIVATE"
        ? {
            title: text.privateTitle,
            description: text.privateDescription,
            label: text.private,
          }
        : {
            title: text.visibleTitle,
            description: text.visibleDescription,
            label: text.visible,
          };
  return (
    <>
      <PageHeader title={text.title} description={text.description} />
      {list.query.error ? (
        <RequestError
          error={list.query.error}
          retry={() => {
            void list.query.refetch();
          }}
        />
      ) : (
        <div data-testid="admin-moderation-table">
          <DataTable
            {...list.table}
            columns={columns}
            label={text.title}
            hiddenColumns={["message_count", "branch", "session_id"]}
            rowId={(row) => row.session_id}
            onRowClick={(row) => {
              window.location.assign(paths.session(row.session_id));
            }}
            emptyTitle={text.empty}
            emptyDescription={text.emptyHint}
            toolbar={
              <FilterBar
                label={copy.app.common.filters}
                activeCount={countActive(filters)}
                onApply={() => {
                  setFilters(toFilters(draft));
                  list.reset();
                }}
                onClear={() => {
                  setDraft(emptyDraft);
                  setFilters({});
                  list.reset();
                }}
                controls={[
                  {
                    id: "repo",
                    label: text.repo,
                    width: "sm:w-52",
                    render: (props) => (
                      <Input
                        {...props}
                        type="search"
                        placeholder={text.repo}
                        value={draft.repo}
                        onChange={(event) => {
                          set("repo")(event.target.value);
                        }}
                      />
                    ),
                  },
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
            }
          />
        </div>
      )}
      <ConfirmDialog
        open={action !== null}
        onOpenChange={(open) => {
          if (!open) setAction(null);
        }}
        title={confirmation.title}
        description={confirmation.description}
        confirmLabel={confirmation.label}
        destructive={action?.kind === "purge"}
        action={async (reason) => {
          if (!action) return;
          const params = { path: { id: action.session.session_id } };
          if (action.kind === "purge")
            unwrap(
              await api.POST("/api/v1/admin/sessions/{id}/purge", {
                params,
                body: { reason },
              }),
            );
          else
            unwrap(
              await api.POST("/api/v1/admin/sessions/{id}/visibility", {
                params,
                body: { visibility: action.visibility, reason },
              }),
            );
          await client.invalidateQueries({ queryKey: [organization.id] });
        }}
      >
        {action?.kind === "purge" && (
          <Alert variant="danger">{text.purgeWarning}</Alert>
        )}
      </ConfirmDialog>
    </>
  );
}
