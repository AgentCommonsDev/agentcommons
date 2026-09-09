import { Copy, LayoutGrid } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { builtinDashboardId } from "@agentcommons/core/schemas/dashboards";
import { QueryState } from "../components/app/states";
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
  return (
    <QueryState query={list}>
      {(data) => <DashboardView id={data.default_id} />}
    </QueryState>
  );
}
export function DashboardPage({ id }: { id: string }) {
  return <DashboardView id={id} />;
}

function EditorFromDashboard({ id, copyOf }: { id: string; copyOf: boolean }) {
  const list = useDashboardList();
  const dashboard = useDashboard(id);
  return (
    <QueryState query={list}>
      {(templates) => (
        <QueryState query={dashboard}>
          {(source) => {
            if (!copyOf && !source.can_edit)
              return (
                <EmptyState
                  title={copy.dashboards.header.editBuiltin}
                  description={source.description}
                  action={
                    <>
                      <Button asChild>
                        <Link
                          to="/app/dashboards/new"
                          search={{ from: source.id }}
                        >
                          <Copy aria-hidden />
                          {copy.app.common.duplicate}
                        </Link>
                      </Button>
                      <Button asChild variant="secondary">
                        <Link
                          to="/app/dashboards/$id"
                          params={{ id: source.id }}
                        >
                          {copy.app.common.back}
                        </Link>
                      </Button>
                    </>
                  }
                />
              );
            const initial: EditorDraft = copyOf
              ? {
                  name: `${copy.dashboards.editor.copyPrefix}${source.name}`.slice(
                    0,
                    80,
                  ),
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
                templates={templates.templates}
                backTo={paths.dashboard(source.id)}
              />
            );
          }}
        </QueryState>
      )}
    </QueryState>
  );
}
function BlankEditor() {
  const list = useDashboardList();
  return (
    <QueryState query={list}>
      {(data) => (
        <DashboardEditor
          initial={{
            name: copy.dashboards.editor.newTitle,
            description: "",
            definition: blankDefinition(),
          }}
          templates={data.templates}
          backTo={paths.home}
        />
      )}
    </QueryState>
  );
}
/** One way to begin a new dashboard: an icon, a name and a one-line hint. */
function StartOption({
  icon: Icon,
  title,
  hint,
  testId,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  hint: string;
  testId: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      className="flex cursor-pointer flex-col items-start gap-2 rounded-lg border border-line bg-surface p-5 text-left transition-colors hover:border-accent hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      onClick={onClick}
    >
      <Icon aria-hidden className="text-accent" />
      <span className="text-[15px] font-semibold">{title}</span>
      <span className="text-sm text-muted">{hint}</span>
    </button>
  );
}
type Start = { kind: "blank" } | { kind: "copy"; id: string };
/** Start from a blank grid, a copy of the shipped dashboard or a duplicate (`?from=<id>`). */
export function DashboardNewPage({ from }: { from: string | undefined }) {
  const [start, setStart] = useState<Start | null>(() =>
    from ? { kind: "copy", id: from } : null,
  );
  if (start?.kind === "copy")
    return <EditorFromDashboard id={start.id} copyOf />;
  if (start?.kind === "blank") return <BlankEditor />;
  const text = copy.dashboards.newPage;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={text.title} description={text.description} />
      <div className="grid gap-3 sm:grid-cols-2 lg:max-w-3xl">
        <StartOption
          icon={LayoutGrid}
          title={text.blank}
          hint={text.blankHint}
          testId="dashboard-start-blank"
          onClick={() => {
            setStart({ kind: "blank" });
          }}
        />
        <StartOption
          icon={Copy}
          title={text.copyDefault}
          hint={text.copyDefaultHint}
          testId="dashboard-start-copy"
          onClick={() => {
            setStart({ kind: "copy", id: builtinDashboardId });
          }}
        />
      </div>
    </div>
  );
}
export function DashboardEditPage({ id }: { id: string }) {
  return <EditorFromDashboard id={id} copyOf={false} />;
}
