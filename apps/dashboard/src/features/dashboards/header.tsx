import {
  Check,
  ChevronsUpDown,
  Copy,
  FileJson,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import type {
  Dashboard,
  DashboardSummary,
} from "@agentcommons/core/schemas/dashboards";
import { copy } from "../../copy";
import { relativeTime } from "../../lib/display";
import { paths } from "../../lib/routes";
import { cn } from "../../lib/utils";
import { ConfirmDialog } from "../../components/app/confirm-dialog";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Alert, Spinner } from "../../components/ui/feedback";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/menu";
import { useDeleteDashboard } from "./api";
import { dashboardJson } from "./model";

function DashboardPicker({
  dashboards,
  current,
  defaultId,
  className,
}: {
  dashboards: readonly DashboardSummary[];
  current: DashboardSummary;
  defaultId: string;
  className?: string | undefined;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          data-testid="dashboard-picker"
          aria-label={copy.dashboards.picker.label}
          className={cn(
            "-ml-2 h-auto max-w-full justify-start gap-2 px-2 py-1 text-[22px] leading-tight font-semibold tracking-tight sm:text-2xl",
            className,
          )}
        >
          <span className="truncate">{current.name}</span>
          <ChevronsUpDown aria-hidden className="text-subtle" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="min-w-72 max-w-[calc(100vw-2rem)]"
      >
        <DropdownMenuLabel>{copy.dashboards.picker.label}</DropdownMenuLabel>
        {dashboards.map((dashboard) => (
          <DropdownMenuItem key={dashboard.id} asChild>
            <a
              href={paths.dashboard(dashboard.id)}
              data-dashboard-id={dashboard.id}
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{dashboard.name}</span>
                <span className="truncate text-xs text-muted">
                  {String(dashboard.tile_count)} {copy.dashboards.picker.tiles}
                  {dashboard.created_by?.email
                    ? `${copy.app.common.separator}${dashboard.created_by.name ?? dashboard.created_by.email}`
                    : ""}
                </span>
              </span>
              {dashboard.builtin && (
                <Badge variant="outline">
                  {copy.dashboards.picker.builtin}
                </Badge>
              )}
              {dashboard.id === defaultId && (
                <Badge variant="accent">{copy.dashboards.picker.default}</Badge>
              )}
              {dashboard.id === current.id && (
                <Check aria-hidden className="text-accent" />
              )}
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Title, picker, metadata and the view-mode actions of a saved or built-in dashboard.
 * The Home default is chosen once, on Settings; this header only shows which one it is.
 */
export function DashboardHeader({
  dashboards,
  dashboard,
  defaultId,
  onRefresh,
  refreshing,
}: {
  dashboards: readonly DashboardSummary[];
  dashboard: Dashboard;
  defaultId: string;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const remove = useDeleteDashboard();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const flash = (message: string) => {
    setNotice(message);
    setTimeout(() => {
      setNotice(null);
    }, 2000);
  };
  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(dashboardJson(dashboard));
      flash(copy.dashboards.header.copiedJson);
    } catch {
      setFailure(copy.app.common.copyFailed);
    }
  };
  const isDefault = dashboard.id === defaultId;
  const author =
    dashboard.created_by?.name ?? dashboard.created_by?.email ?? null;
  const duplicateHref = `${paths.dashboardNew}?from=${encodeURIComponent(dashboard.id)}`;
  return (
    <>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <DashboardPicker
            dashboards={dashboards}
            current={dashboard}
            defaultId={defaultId}
          />
          {dashboard.description && (
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
              {dashboard.description}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            {dashboard.builtin && (
              <Badge variant="outline">{copy.dashboards.picker.builtin}</Badge>
            )}
            {isDefault && (
              <Badge variant="accent">{copy.dashboards.picker.default}</Badge>
            )}
            {!dashboard.builtin && author && (
              <span>
                {copy.dashboards.header.createdBy} {author}
              </span>
            )}
            {!dashboard.builtin && (
              <span>
                {copy.dashboards.header.updated}{" "}
                {relativeTime(dashboard.updated_at)}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" asChild>
            <a
              href={paths.dashboardNew}
              aria-label={copy.dashboards.picker.newDashboard}
            >
              <Plus aria-hidden />
              <span className="hidden sm:inline">
                {copy.dashboards.picker.newDashboard}
              </span>
            </a>
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label={copy.app.common.refresh}
          >
            {refreshing ? <Spinner size={14} /> : <RefreshCw aria-hidden />}
            <span className="hidden sm:inline">{copy.app.common.refresh}</span>
          </Button>
          {/* A dashboard you cannot edit offers Duplicate in Edit's place: the path to changing it. */}
          {dashboard.can_edit ? (
            <Button variant="secondary" size="sm" asChild>
              <a
                href={paths.dashboardEdit(dashboard.id)}
                data-testid="dashboard-edit"
              >
                <Pencil aria-hidden />
                {copy.app.common.edit}
              </a>
            </Button>
          ) : (
            <Button variant="secondary" size="sm" asChild>
              <a href={duplicateHref} data-testid="dashboard-duplicate">
                <Copy aria-hidden />
                {copy.app.common.duplicate}
              </a>
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="secondary"
                size="icon-sm"
                aria-label={copy.dashboards.header.more}
              >
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-60">
              {dashboard.can_edit && (
                <DropdownMenuItem asChild>
                  <a href={duplicateHref}>
                    <Copy aria-hidden />
                    {copy.app.common.duplicate}
                  </a>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onSelect={() => {
                  void copyJson();
                }}
              >
                <FileJson aria-hidden />
                {copy.dashboards.header.copyJson}
              </DropdownMenuItem>
              {dashboard.can_edit && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    destructive
                    onSelect={() => {
                      setConfirmDelete(true);
                    }}
                  >
                    <Trash2 aria-hidden />
                    {copy.app.common.delete}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <span
        role="status"
        className={notice ? "text-xs text-success" : "sr-only"}
      >
        {notice ?? ""}
      </span>
      {failure && <Alert variant="danger">{failure}</Alert>}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={copy.dashboards.header.deleteTitle}
        description={copy.dashboards.header.deleteDescription}
        confirmLabel={copy.app.common.delete}
        requireReason={false}
        action={async () => {
          await remove.mutateAsync(dashboard.id);
          window.location.assign(paths.home);
        }}
      />
    </>
  );
}
