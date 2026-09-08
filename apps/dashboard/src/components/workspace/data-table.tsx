import {
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import type {
  ColumnDef,
  SortingState,
  OnChangeFn,
  VisibilityState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Download,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { copy } from "../../copy";
import { csvBlob, downloadBlob } from "../../lib/csv";
import type { Page } from "../../lib/types";
import { errorMessage } from "../../lib/display";
import { Button } from "../ui/button";
import { EmptyState, LoadingState } from "./primitives";

export function DataTable<T>({
  data,
  columns,
  sorting,
  onSortingChange,
  loading = false,
  nextCursor,
  pageIndex,
  onNext,
  onPrevious,
  label,
  csvName,
  fetchExportPage,
}: {
  data: T[];
  columns: ColumnDef<T>[];
  sorting: SortingState;
  onSortingChange: OnChangeFn<SortingState>;
  loading?: boolean;
  nextCursor: string | null;
  pageIndex: number;
  onNext: () => void;
  onPrevious: () => void;
  label: string;
  csvName: string;
  fetchExportPage: (
    cursor: string | null,
    signal: AbortSignal,
  ) => Promise<Page<T>>;
}) {
  const parent = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const element = parent.current;
    if (!element) return;
    const measure = () => {
      setOverflow(element.scrollWidth > element.clientWidth + 1);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const grid = element.querySelector("table");
    if (grid) observer.observe(grid);
    measure();
    return () => {
      observer.disconnect();
    };
  }, []);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const exportController = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      exportController.current?.abort();
    },
    [],
  );
  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnVisibility },
    onSortingChange,
    onColumnVisibilityChange: setColumnVisibility,
    manualSorting: true,
    enableSortingRemoval: false,
    getCoreRowModel: getCoreRowModel(),
  });
  const rows = table.getRowModel().rows;
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parent.current,
    estimateSize: () => 54,
    overscan: 8,
  });
  const items = virtual.getVirtualItems();
  const top = items[0]?.start ?? 0;
  const bottom = virtual.getTotalSize() - (items.at(-1)?.end ?? 0);
  const exportCsv = async () => {
    const controller = new AbortController();
    exportController.current = controller;
    setExporting(true);
    setExportError(null);
    try {
      const visible = table
        .getVisibleLeafColumns()
        .filter((column) => column.accessorFn !== undefined);
      const source: T[] = [];
      let cursor: string | null = null;
      do {
        const page = await fetchExportPage(cursor, controller.signal);
        source.push(...page.items);
        cursor = page.cursor;
      } while (cursor !== null && !controller.signal.aborted);
      if (controller.signal.aborted) return;
      const blob = csvBlob(
        visible.map((column) =>
          typeof column.columnDef.header === "string"
            ? column.columnDef.header
            : column.id,
        ),
        source.map((row, index) =>
          visible.map((column) => column.accessorFn?.(row, index)),
        ),
      );
      downloadBlob(blob, csvName);
    } catch (error) {
      if (!controller.signal.aborted) setExportError(errorMessage(error));
    } finally {
      if (exportController.current === controller) {
        exportController.current = null;
        setExporting(false);
      }
    }
  };
  return (
    <div className="data-table">
      <div className="table-toolbar">
        <span>{label}</span>
        <div>
          <details className="column-chooser">
            <summary>
              <Columns3 size={15} aria-hidden />
              {copy.workspace.common.columns}
            </summary>
            <div>
              {table
                .getAllLeafColumns()
                .filter((column) => column.getCanHide())
                .map((column) => (
                  <label key={column.id}>
                    <input
                      type="checkbox"
                      checked={column.getIsVisible()}
                      onChange={column.getToggleVisibilityHandler()}
                    />
                    {typeof column.columnDef.header === "string"
                      ? column.columnDef.header
                      : column.id}
                  </label>
                ))}
            </div>
          </details>
          <Button
            variant="secondary"
            size="small"
            disabled={exporting || data.length === 0}
            onClick={() => {
              void exportCsv();
            }}
          >
            <Download size={15} aria-hidden />
            {exporting
              ? copy.workspace.common.exporting
              : copy.workspace.common.export}
          </Button>
          {exporting && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                exportController.current?.abort();
              }}
              aria-label={copy.workspace.common.cancelExport}
            >
              <X size={15} aria-hidden />
            </Button>
          )}
        </div>
      </div>
      {exportError && (
        <p role="alert" className="form-error">
          {exportError}
        </p>
      )}
      {overflow && (
        <p className="table-scroll-hint">
          {copy.workspace.common.tableScrollHint}
        </p>
      )}
      <div
        ref={parent}
        className="table-scroll"
        role="region"
        aria-label={label}
        tabIndex={0}
        aria-busy={loading}
      >
        <table>
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => (
                  <th
                    key={header.id}
                    scope="col"
                    aria-sort={
                      header.column.getIsSorted() === "asc"
                        ? "ascending"
                        : header.column.getIsSorted() === "desc"
                          ? "descending"
                          : "none"
                    }
                  >
                    {header.isPlaceholder ? null : header.column.getCanSort() ? (
                      <button onClick={header.column.getToggleSortingHandler()}>
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                        {header.column.getIsSorted() === "asc" ? (
                          <ArrowUp size={12} aria-hidden />
                        ) : header.column.getIsSorted() === "desc" ? (
                          <ArrowDown size={12} aria-hidden />
                        ) : (
                          <ArrowUpDown size={12} aria-hidden />
                        )}
                      </button>
                    ) : (
                      flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {top > 0 && (
              <tr aria-hidden>
                <td
                  colSpan={table.getVisibleLeafColumns().length}
                  style={{ height: top, padding: 0, border: 0 }}
                />
              </tr>
            )}
            {items.map((item) => {
              const row = rows[item.index];
              return row ? (
                <tr
                  key={row.id}
                  data-index={item.index}
                  ref={virtual.measureElement}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </td>
                  ))}
                </tr>
              ) : null;
            })}
            {bottom > 0 && (
              <tr aria-hidden>
                <td
                  colSpan={table.getVisibleLeafColumns().length}
                  style={{ height: bottom, padding: 0, border: 0 }}
                />
              </tr>
            )}
          </tbody>
        </table>
        {loading && <LoadingState />}
        {!loading && data.length === 0 && (
          <EmptyState
            title={copy.workspace.common.empty}
            description={copy.workspace.common.emptyHint}
          />
        )}
      </div>
      <div className="table-pagination">
        <span>
          {copy.workspace.common.page} {pageIndex + 1}
          {copy.workspace.common.separator}
          {data.length} {copy.workspace.common.rows}
        </span>
        <div>
          <Button
            variant="secondary"
            size="small"
            disabled={pageIndex === 0 || loading}
            onClick={onPrevious}
          >
            <ChevronLeft size={15} aria-hidden />
            {copy.workspace.common.previous}
          </Button>
          <Button
            variant="secondary"
            size="small"
            disabled={nextCursor === null || loading}
            onClick={onNext}
          >
            {copy.workspace.common.next}
            <ChevronRight size={15} aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}
