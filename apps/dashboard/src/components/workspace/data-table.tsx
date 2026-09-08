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
import * as Dialog from "@radix-ui/react-dialog";
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
  summaryColumnIds,
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
  summaryColumnIds?: readonly string[];
}) {
  const parent = useRef<HTMLDivElement>(null);
  const defaults = Object.fromEntries(
    columns.map((column, index) => {
      const id =
        column.id ??
        ("accessorKey" in column ? String(column.accessorKey) : String(index));
      const dataColumn = "accessorKey" in column || "accessorFn" in column;
      return [
        id,
        !dataColumn ||
          (summaryColumnIds ? summaryColumnIds.includes(id) : index < 4),
      ];
    }),
  );
  const [columnVisibility, setColumnVisibility] =
    useState<VisibilityState>(defaults);
  useEffect(() => {
    setColumnVisibility((prior) => {
      const missing = Object.entries(defaults).filter(([id]) => !(id in prior));
      return missing.length
        ? { ...prior, ...Object.fromEntries(missing) }
        : prior;
    });
  }, [defaults]);
  const [dialog, setDialog] = useState<string | null>(null);
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
        .getAllLeafColumns()
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
          <Button
            variant="secondary"
            size="small"
            onClick={() => {
              setDialog("columns");
            }}
          >
            <Columns3 size={15} aria-hidden />
            {copy.workspace.common.columns}
          </Button>
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
      <p className="table-summary-hint">
        {copy.workspace.common.summaryColumns}
      </p>
      {table.getAllLeafColumns().some((column) => column.getCanSort()) && (
        <div className="table-sort-control">
          <label>
            <span>{copy.workspace.common.sortBy}</span>
            <select
              value={sorting[0]?.id ?? ""}
              onChange={(event) => {
                onSortingChange([
                  { id: event.target.value, desc: sorting[0]?.desc ?? false },
                ]);
              }}
            >
              {table
                .getAllLeafColumns()
                .filter((column) => column.getCanSort())
                .map((column) => (
                  <option key={column.id} value={column.id}>
                    {typeof column.columnDef.header === "string"
                      ? column.columnDef.header
                      : column.id}
                  </option>
                ))}
            </select>
          </label>
          <Button
            variant="ghost"
            size="small"
            disabled={!sorting[0]}
            onClick={() => {
              const current = sorting[0];
              if (current)
                onSortingChange([{ ...current, desc: !current.desc }]);
            }}
          >
            {sorting[0]?.desc
              ? copy.workspace.common.sortDescending
              : copy.workspace.common.sortAscending}
          </Button>
        </div>
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
                <th scope="col">{copy.workspace.common.details}</th>
              </tr>
            ))}
          </thead>
          <tbody>
            {top > 0 && (
              <tr aria-hidden>
                <td
                  colSpan={table.getVisibleLeafColumns().length + 1}
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
                    <td
                      key={cell.id}
                      data-label={
                        typeof cell.column.columnDef.header === "string"
                          ? cell.column.columnDef.header
                          : cell.column.id
                      }
                      data-actions={
                        cell.column.accessorFn === undefined || undefined
                      }
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </td>
                  ))}
                  <td className="record-details-cell">
                    <Button
                      variant="ghost"
                      size="small"
                      onClick={() => {
                        setDialog(row.id);
                      }}
                    >
                      {copy.workspace.common.viewDetails}
                    </Button>
                  </td>
                </tr>
              ) : null;
            })}
            {bottom > 0 && (
              <tr aria-hidden>
                <td
                  colSpan={table.getVisibleLeafColumns().length + 1}
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
      <Dialog.Root
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content table-detail-dialog">
            <div className="dialog-heading">
              <Dialog.Title>
                {dialog === "columns"
                  ? copy.workspace.common.columns
                  : copy.workspace.common.details}
              </Dialog.Title>
              <Dialog.Close asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={copy.workspace.common.close}
                >
                  <X size={18} aria-hidden />
                </Button>
              </Dialog.Close>
            </div>
            <Dialog.Description>
              {dialog === "columns" ? copy.workspace.common.columnsHint : label}
            </Dialog.Description>
            {dialog === "columns" ? (
              <div className="column-options">
                {table
                  .getAllLeafColumns()
                  .filter((column) => column.accessorFn !== undefined)
                  .map((column) => (
                    <label key={column.id}>
                      <input
                        type="checkbox"
                        checked={column.getIsVisible()}
                        disabled={
                          !column.getIsVisible() &&
                          table
                            .getVisibleLeafColumns()
                            .filter((item) => item.accessorFn !== undefined)
                            .length >= 5
                        }
                        onChange={column.getToggleVisibilityHandler()}
                      />
                      {typeof column.columnDef.header === "string"
                        ? column.columnDef.header
                        : column.id}
                    </label>
                  ))}
              </div>
            ) : (
              <dl className="record-fields">
                {rows
                  .find((row) => row.id === dialog)
                  ?.getAllCells()
                  .filter((cell) => cell.column.accessorFn !== undefined)
                  .map((cell) => (
                    <div key={cell.id}>
                      <dt>
                        {typeof cell.column.columnDef.header === "string"
                          ? cell.column.columnDef.header
                          : cell.column.id}
                      </dt>
                      <dd>
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </dd>
                    </div>
                  ))}
              </dl>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
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
