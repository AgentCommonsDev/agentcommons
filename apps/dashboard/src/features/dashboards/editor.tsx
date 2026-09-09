import { Plus, Settings2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  dashboardDefinitionSchema,
  dashboardNameSchema,
  type DashboardDefinition,
  type DashboardTile,
  type DashboardTileTemplate,
} from "@agentcommons/core/schemas/dashboards";
import { copy } from "../../copy";
import { errorMessage } from "../../lib/display";
import { paths } from "../../lib/routes";
import { ConfirmDialog } from "../../components/app/confirm-dialog";
import { Button } from "../../components/ui/button";
import { Alert, EmptyState } from "../../components/ui/feedback";
import { Input } from "../../components/ui/input";
import { AddTileDialog } from "./add-tile";
import { errorCode, useDashboardData, useSaveDashboard } from "./api";
import { DashboardGrid } from "./grid";
import { formatIssues, TileInspector } from "./inspector";
import {
  addTemplate,
  blankTile,
  duplicateTile,
  moveTile,
  placeTile,
  readingOrder,
  removeTile,
  replaceTile,
  type GridBreakpoint,
} from "./model";
import { DashboardSettingsDialog } from "./settings";
import { DashboardTileCard } from "./tiles";
import { useVariableState } from "./use-variables";
import { VariablesBar } from "./variables";

export interface EditorDraft {
  id?: string;
  revision?: number;
  name: string;
  description: string;
  definition: DashboardDefinition;
}
const serialize = (draft: EditorDraft) => JSON.stringify(draft);

/** Grid editor for a new or saved dashboard. Saves through POST /dashboards with the revision. */
export function DashboardEditor({
  initial,
  templates,
  backTo,
}: {
  initial: EditorDraft;
  templates: readonly DashboardTileTemplate[];
  backTo: string;
}) {
  const [draft, setDraft] = useState(initial);
  const baseline = useRef(serialize(initial));
  const dirty = serialize(draft) !== baseline.current;
  const leaving = useRef(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [settings, setSettings] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [breakpoint, setBreakpoint] = useState<GridBreakpoint>("lg");
  const save = useSaveDashboard();
  const { definition } = draft;
  const { values, setVariable } = useVariableState(definition.variables);
  const data = useDashboardData({
    scope: `draft:${initial.id ?? "new"}`,
    source: { definition },
    variables: values,
    enabled: definition.tiles.length > 0,
  });
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (leaving.current) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
    };
  }, [dirty]);
  const setDefinition = (next: DashboardDefinition) => {
    setDraft((prior) => ({ ...prior, definition: next }));
  };
  const selectedTile = useMemo(
    () => definition.tiles.find((tile) => tile.id === selected) ?? null,
    [definition.tiles, selected],
  );
  const ordered = useMemo(
    () => readingOrder(definition.tiles),
    [definition.tiles],
  );
  const addFromTemplate = (template: DashboardTileTemplate) => {
    const next = addTemplate(definition, template);
    setDefinition(next.definition);
    setAdding(false);
    void data.refreshTile(next.tile.id, next.definition);
  };
  const addBlank = (type: "stat" | "chart" | "table" | "text") => {
    const tile = placeTile(definition, blankTile(definition, type));
    const next = { ...definition, tiles: [...definition.tiles, tile] };
    setDefinition(next);
    setAdding(false);
    setSelected(tile.id);
    if ("sql" in tile) void data.refreshTile(tile.id, next);
  };
  const updateTile = (id: string, tile: DashboardTile) => {
    setDefinition(replaceTile(definition, id, tile));
    if (tile.id !== id && selected === id) setSelected(tile.id);
  };
  const submit = async () => {
    setSaveError(null);
    const name = dashboardNameSchema.safeParse(draft.name);
    const parsed = dashboardDefinitionSchema.safeParse(definition);
    const found = [
      ...(name.success
        ? []
        : formatIssues(name.error).map((issue) => `name: ${issue}`)),
      ...(parsed.success ? [] : formatIssues(parsed.error)),
    ];
    setIssues(found);
    if (!name.success || !parsed.success) return;
    try {
      const saved = await save.mutateAsync({
        ...(draft.id === undefined
          ? {}
          : { id: draft.id, revision: draft.revision ?? 0 }),
        name: name.data,
        description: draft.description.trim(),
        definition: parsed.data,
      });
      leaving.current = true;
      baseline.current = serialize(draft);
      window.location.assign(paths.dashboard(saved.id));
    } catch (error) {
      setSaveError(error);
    }
  };
  const leave = () => {
    leaving.current = true;
    window.location.assign(backTo);
  };
  const conflict = errorCode(saveError) === "DASHBOARD_CHANGED";
  return (
    <div
      className="flex flex-col gap-4"
      data-testid="dashboard-editor"
      data-dirty={dirty}
    >
      <header className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-xs font-medium text-muted">
            {draft.id === undefined
              ? copy.dashboards.editor.newTitle
              : copy.dashboards.editor.title}
          </span>
          <Input
            aria-label={copy.app.fields.name}
            placeholder={copy.dashboards.editor.namePlaceholder}
            data-testid="dashboard-name"
            className="h-10 max-w-xl text-lg font-semibold"
            value={draft.name}
            maxLength={80}
            onChange={(event) => {
              setDraft((prior) => ({ ...prior, name: event.target.value }));
            }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            data-testid="tile-add"
            onClick={() => {
              setAdding(true);
            }}
          >
            <Plus aria-hidden />
            {copy.dashboards.editor.addTile}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            data-testid="dashboard-settings-open"
            aria-label={copy.dashboards.editor.settings}
            onClick={() => {
              setSettings(true);
            }}
          >
            <Settings2 aria-hidden />
            <span className="hidden sm:inline">
              {copy.dashboards.editor.settings}
            </span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            data-testid="dashboard-cancel"
            onClick={() => {
              if (dirty) setConfirmCancel(true);
              else leave();
            }}
          >
            {copy.app.common.cancel}
          </Button>
          <Button
            size="sm"
            data-testid="dashboard-save"
            disabled={save.isPending}
            onClick={() => {
              void submit();
            }}
          >
            {save.isPending ? copy.app.common.saving : copy.app.common.save}
          </Button>
        </div>
      </header>
      {issues.length > 0 && (
        <Alert variant="danger" title={copy.dashboards.editor.invalidTitle}>
          <ul className="list-disc pl-4 font-mono text-xs">
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </Alert>
      )}
      {saveError !== null &&
        (conflict ? (
          <Alert
            variant="warning"
            title={copy.dashboards.editor.conflictTitle}
            action={
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  leaving.current = true;
                  window.location.reload();
                }}
              >
                {copy.dashboards.editor.reload}
              </Button>
            }
          >
            {copy.dashboards.editor.conflictHint}
          </Alert>
        ) : (
          <Alert variant="danger">{errorMessage(saveError)}</Alert>
        ))}
      <VariablesBar
        variables={definition.variables}
        values={values}
        onChange={setVariable}
      />
      {data.error !== null && (
        <Alert variant="danger">{errorMessage(data.error)}</Alert>
      )}
      {definition.tiles.length > 0 && breakpoint !== "lg" && (
        <Alert variant="info">{copy.dashboards.editor.smallScreen}</Alert>
      )}
      {definition.tiles.length === 0 ? (
        <EmptyState
          title={copy.dashboards.editor.noTiles}
          description={copy.dashboards.editor.noTilesHint}
          action={
            <Button
              onClick={() => {
                setAdding(true);
              }}
            >
              <Plus aria-hidden />
              {copy.dashboards.editor.addTile}
            </Button>
          }
        />
      ) : (
        <DashboardGrid
          tiles={definition.tiles}
          editing
          onBreakpoint={setBreakpoint}
          onTilesChange={(tiles) => {
            setDefinition({ ...definition, tiles });
          }}
          renderTile={(tile) => {
            const index = ordered.findIndex((entry) => entry.id === tile.id);
            return (
              <DashboardTileCard
                tile={tile}
                result={data.results.get(tile.id)}
                loading={data.pending}
                refreshing={data.refreshing.has(tile.id)}
                editing
                selected={tile.id === selected}
                onRefresh={() => {
                  void data.refreshTile(tile.id);
                }}
                actions={{
                  edit: () => {
                    setSelected(tile.id);
                  },
                  duplicate: () => {
                    setDefinition(duplicateTile(definition, tile.id));
                  },
                  remove: () => {
                    if (selected === tile.id) setSelected(null);
                    setDefinition(removeTile(definition, tile.id));
                  },
                  moveUp:
                    index > 0
                      ? () => {
                          setDefinition(moveTile(definition, tile.id, "up"));
                        }
                      : null,
                  moveDown:
                    index < ordered.length - 1
                      ? () => {
                          setDefinition(moveTile(definition, tile.id, "down"));
                        }
                      : null,
                }}
                variables={definition.variables}
                values={values}
                onVariableChange={setVariable}
              />
            );
          }}
        />
      )}
      <AddTileDialog
        open={adding}
        onOpenChange={setAdding}
        templates={templates}
        onTemplate={addFromTemplate}
        onBlank={addBlank}
      />
      <TileInspector
        tile={selectedTile}
        definition={definition}
        preview={selectedTile ? data.results.get(selectedTile.id) : undefined}
        previewing={selectedTile ? data.refreshing.has(selectedTile.id) : false}
        onChange={(tile) => {
          if (selectedTile) updateTile(selectedTile.id, tile);
        }}
        onClose={() => {
          setSelected(null);
        }}
        onPreview={(id) => {
          void data.refreshTile(id, definition);
        }}
      />
      <DashboardSettingsDialog
        open={settings}
        onOpenChange={setSettings}
        description={draft.description}
        definition={definition}
        onDescription={(description) => {
          setDraft((prior) => ({ ...prior, description }));
        }}
        onDefinition={(next) => {
          setDefinition(next);
          void data.invalidate();
        }}
      />
      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title={copy.dashboards.editor.discardTitle}
        description={copy.dashboards.editor.discardDescription}
        confirmLabel={copy.dashboards.editor.discard}
        requireReason={false}
        action={() => {
          leave();
          return Promise.resolve();
        }}
      />
    </div>
  );
}
