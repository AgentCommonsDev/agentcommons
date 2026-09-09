import type {
  DashboardTile,
  DashboardTileTemplate,
} from "@agentcommons/core/schemas/dashboards";
import { copy } from "../../copy";
import { Badge } from "../../components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
} from "../../components/ui/dialog";

const order: DashboardTile["type"][] = [
  "stat",
  "chart",
  "table",
  "text",
  "control",
];
const blankTypes = ["stat", "chart", "table", "text"] as const;

function TemplateButton({
  title,
  description,
  type,
  onClick,
}: {
  title: string;
  description: string;
  type: DashboardTile["type"];
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-template={title}
      className="flex min-w-0 cursor-pointer flex-col gap-1 rounded-lg border border-line bg-surface px-3 py-2.5 text-left transition-colors hover:border-accent hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      onClick={onClick}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium">{title}</span>
        <Badge variant="outline">{copy.dashboards.tiles.types[type]}</Badge>
      </span>
      {description && (
        <span className="text-xs leading-relaxed text-muted">
          {description}
        </span>
      )}
    </button>
  );
}
/** Starter tiles grouped by type plus blank tiles. */
export function AddTileDialog({
  open,
  onOpenChange,
  templates,
  onTemplate,
  onBlank,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: readonly DashboardTileTemplate[];
  onTemplate: (template: DashboardTileTemplate) => void;
  onBlank: (type: (typeof blankTypes)[number]) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" data-testid="tile-add-dialog">
        <DialogHeader
          title={copy.dashboards.addTile.title}
          description={copy.dashboards.addTile.description}
        />
        <div className="flex flex-col gap-5">
          {order.map((type) => {
            const group = templates.filter(
              (template) => template.tile.type === type,
            );
            if (group.length === 0) return null;
            return (
              <section key={type} className="flex flex-col gap-2">
                <h3 className="text-xs font-medium tracking-wide text-subtle uppercase">
                  {copy.dashboards.tiles.types[type]}
                </h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {group.map((template) => (
                    <TemplateButton
                      key={template.id}
                      title={template.title}
                      description={template.description}
                      type={type}
                      onClick={() => {
                        onTemplate(template);
                      }}
                    />
                  ))}
                </div>
              </section>
            );
          })}
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-medium tracking-wide text-subtle uppercase">
              {copy.dashboards.addTile.blankGroup}
            </h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {blankTypes.map((type) => (
                <TemplateButton
                  key={type}
                  title={copy.dashboards.tiles.blank[type]}
                  description=""
                  type={type}
                  onClick={() => {
                    onBlank(type);
                  }}
                />
              ))}
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
