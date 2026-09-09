import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Responsive,
  getBreakpointFromWidth,
  type Layout,
} from "react-grid-layout";
import type { DashboardTile } from "@agentcommons/core/schemas/dashboards";
import { TooltipProvider } from "../../components/ui/menu";
import {
  applyLayout,
  gridBreakpoints,
  gridColumns,
  gridMargin,
  gridRowHeight,
  layoutChanged,
  responsiveLayouts,
  type GridBreakpoint,
} from "./model";

/**
 * Container width from a ResizeObserver. Widths under 100px are transient layout states
 * (screenshot capture, hidden tabs) and would flip the grid to the phone breakpoint.
 */
function useGridWidth() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const accept = (next: number) => {
      const rounded = Math.round(next);
      if (rounded >= 100)
        setWidth((prior) => (prior === rounded ? prior : rounded));
    };
    accept(node.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) accept(entry.contentRect.width);
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, []);
  return { containerRef, width };
}
/**
 * Responsive 12-column grid. Desktop keeps the saved layout, tablets scale it to 8
 * columns and phones stack every tile full width in reading order.
 */
export function DashboardGrid({
  tiles,
  editing,
  onTilesChange,
  renderTile,
  onBreakpoint,
}: {
  tiles: readonly DashboardTile[];
  editing: boolean;
  onTilesChange?: ((tiles: DashboardTile[]) => void) | undefined;
  renderTile: (tile: DashboardTile) => ReactNode;
  onBreakpoint?: ((breakpoint: GridBreakpoint) => void) | undefined;
}) {
  const { width, containerRef } = useGridWidth();
  const breakpoint = getBreakpointFromWidth(gridBreakpoints, width ?? 1200);
  const layouts = useMemo(() => responsiveLayouts(tiles), [tiles]);
  const interactive = editing && breakpoint === "lg";
  useEffect(() => {
    if (width !== null) onBreakpoint?.(breakpoint);
  }, [breakpoint, width, onBreakpoint]);
  const commit = (layout: Layout) => {
    if (!interactive || !onTilesChange || !layoutChanged(tiles, layout)) return;
    onTilesChange(applyLayout(tiles, layout));
  };
  return (
    <TooltipProvider delayDuration={200}>
      <div ref={containerRef} className="w-full min-w-0">
        {width !== null && (
          <Responsive<GridBreakpoint>
            width={width}
            breakpoints={gridBreakpoints}
            cols={gridColumns}
            layouts={layouts}
            rowHeight={gridRowHeight}
            margin={gridMargin}
            containerPadding={[0, 0]}
            dragConfig={{
              enabled: interactive,
              handle: ".tile-drag-handle",
              threshold: 4,
            }}
            resizeConfig={{ enabled: interactive, handles: ["se"] }}
            onLayoutChange={(layout, all) => {
              const current = all[breakpoint] ?? layout;
              if (breakpoint === "lg") commit(current);
            }}
            onDragStop={commit}
            onResizeStop={commit}
          >
            {tiles.map((tile) => (
              <div
                key={tile.id}
                data-testid={`dashboard-tile-${tile.id}`}
                data-tile-type={tile.type}
                className="min-w-0"
              >
                {renderTile(tile)}
              </div>
            ))}
          </Responsive>
        )}
      </div>
    </TooltipProvider>
  );
}
