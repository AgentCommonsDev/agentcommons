import { Copy, LayoutGrid } from "lucide-react";
import { useState } from "react";
import { builtinDashboardId } from "@agentcommons/core/schemas/dashboards";
import { LoadingState, RequestError } from "../components/app/states";
import { Button } from "../components/ui/button";
import { EmptyState, PageHeader } from "../components/ui/feedback";
import { copy } from "../copy";
import { useDashboard, useDashboardList } from "../features/dashboards/api";
import {
  DashboardEditor,
  type EditorDraft,
} from "../features/dashboards/editor";
import { blankDefinition } from "../features/dashboards/model";
import { DashboardView } from "../features/dashboards/view";
import { paths } from "../lib/routes";

/** Home shows the organization's default dashboard. */
export function HomePage() {
  const list = useDashboardList();
  if (list.isPending) return <LoadingState />;
  if (list.error)
    return (
      <RequestError
        error={list.error}
        retry={() => {
          void list.refetch();
        }}
      />
    );
  return <DashboardView id={list.data.default_id} />;
}
export function DashboardPage({ id }: { id: string }) {
  return <DashboardView id={id} />;
}

function EditorFromDashboard({ id, copyOf }: { id: string; copyOf: boolean }) {
  const list = useDashboardList();
  const dashboard = useDashboard(id);
  const error = list.error ?? dashboard.error;
  if (error)
    return (
      <RequestError
        error={error}
        retry={() => {
          void list.refetch();
          void dashboard.refetch();
        }}
      />
    );
  if (!list.data || !dashboard.data) return <LoadingState />;
  const source = dashboard.data;
  if (!copyOf && !source.can_edit)
    return (
      <EmptyState
        title={copy.dashboards.header.editBuiltin}
        description={source.description}
        action={
          <>
            <Button asChild>
              <a
                href={`${paths.dashboardNew}?from=${encodeURIComponent(source.id)}`}
              >
                <Copy aria-hidden />
                {copy.app.common.duplicate}
              </a>
            </Button>
            <Button asChild variant="secondary">
              <a href={paths.dashboard(source.id)}>{copy.app.common.back}</a>
            </Button>
          </>
        }
      />
    );
  const initial: EditorDraft = copyOf
    ? {
        name: `${copy.dashboards.editor.copyPrefix}${source.name}`.slice(0, 80),
        description: source.description,
        definition: source.definition,
      }
    : {
        id: source.id,
        revision: source.revision,
        name: source.name,
        description: source.description,
        definition: source.definition,
      };
  return (
    <DashboardEditor
      initial={initial}
      templates={list.data.templates}
      backTo={paths.dashboard(source.id)}
    />
  );
}
function BlankEditor() {
  const list = useDashboardList();
  if (list.isPending) return <LoadingState />;
  if (list.error)
    return (
      <RequestError
        error={list.error}
        retry={() => {
          void list.refetch();
        }}
      />
    );
  return (
    <DashboardEditor
      initial={{
        name: copy.dashboards.editor.newTitle,
        description: "",
        definition: blankDefinition(),
      }}
      templates={list.data.templates}
      backTo={paths.home}
    />
  );
}
const fromParam = () =>
  typeof window === "undefined"
    ? null
    : new URLSearchParams(window.location.search).get("from");

/** Start from a blank grid, a copy of the shipped dashboard or a duplicate (`?from=<id>`). */
export function DashboardNewPage() {
  const [start, setStart] = useState<
    { kind: "blank" } | { kind: "copy"; id: string } | null
  >(() => {
    const from = fromParam();
    return from ? { kind: "copy", id: from } : null;
  });
  if (start?.kind === "copy")
    return <EditorFromDashboard id={start.id} copyOf />;
  if (start?.kind === "blank") return <BlankEditor />;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={copy.dashboards.newPage.title}
        description={copy.dashboards.newPage.description}
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:max-w-3xl">
        <button
          type="button"
          data-testid="dashboard-start-blank"
          className="flex cursor-pointer flex-col items-start gap-2 rounded-lg border border-line bg-surface p-5 text-left transition-colors hover:border-accent hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          onClick={() => {
            setStart({ kind: "blank" });
          }}
        >
          <LayoutGrid aria-hidden className="text-accent" />
          <span className="text-[15px] font-semibold">
            {copy.dashboards.newPage.blank}
          </span>
          <span className="text-sm text-muted">
            {copy.dashboards.newPage.blankHint}
          </span>
        </button>
        <button
          type="button"
          data-testid="dashboard-start-copy"
          className="flex cursor-pointer flex-col items-start gap-2 rounded-lg border border-line bg-surface p-5 text-left transition-colors hover:border-accent hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          onClick={() => {
            setStart({ kind: "copy", id: builtinDashboardId });
          }}
        >
          <Copy aria-hidden className="text-accent" />
          <span className="text-[15px] font-semibold">
            {copy.dashboards.newPage.copyDefault}
          </span>
          <span className="text-sm text-muted">
            {copy.dashboards.newPage.copyDefaultHint}
          </span>
        </button>
      </div>
    </div>
  );
}
export function DashboardEditPage({ id }: { id: string }) {
  return <EditorFromDashboard id={id} copyOf={false} />;
}
