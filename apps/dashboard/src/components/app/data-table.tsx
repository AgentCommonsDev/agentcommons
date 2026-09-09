import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type OnChangeFn,
  type Row,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Download,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { z } from "zod";
import { copy } from "../../copy";
import { csvBlob, downloadBlob } from "../../lib/csv";
import { errorMessage } from "../../lib/display";
import type { Page } from "../../lib/types";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogHeader } from "../ui/dialog";
import { Alert, EmptyState } from "../ui/feedback";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "../ui/menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import { DefinitionList, LoadingState, RequestError } from "./states";

export interface DataTablePage {
  index: number;
  hasNext: boolean;
  onNext: () => void;
  onPrevious: () => void;
}
interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T>[];
  /** Server-side sorting state; omit for unsortable tables. */
  sorting?: SortingState;
  onSortingChange?: OnChangeFn<SortingState>;
  loading?: boolean;
  page?: DataTablePage;
  /** Accessible name and CSV file stem. */
  label: string;
  csv?: {
    name: string;
    fetchAll: (cursor: string | null, signal: AbortSignal) => Promise<Page<T>>;
  };
  /** Column ids hidden until the reader turns them on. */
  hiddenColumns?: readonly string[];
  /** Extra controls rendered in the toolbar, before the built-in ones. */
  toolbar?: ReactNode;
  /** Row click handler; when omitted a row opens its full record. */
  onRowClick?: (row: T) => void;
  rowId?: (row: T, index: number) => string;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  /** The page query's failure; shown in place of the rows with a retry. */
  error?: unknown;
  retry?: (() => void) | undefined;
  compact?: boolean;
}
function columnId<T>(column: ColumnDef<T>, index: number): string {
  return (
    column.id ??
    ("accessorKey" in column ? String(column.accessorKey) : String(index))
  );
}
function headerText<T>(column: ColumnDef<T>, fallback: string): string {
  return typeof column.header === "string" ? column.header : fallback;
}
/** Column choices survive navigation: one browser-local entry per table, keyed by its label. */
const storedVisibility = z.record(z.string(), z.boolean());
function readVisibility(key: string): VisibilityState {
  try {
    const raw = localStorage.getItem(key);
    return raw ? storedVisibility.parse(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}
function writeVisibility(key: string, value: VisibilityState) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage may be unavailable; the choice then lasts for the page only.
  }
}
export function DataTable<T>({
  data,
  columns,
  sorting,
  onSortingChange,
  loading = false,
  page,
  label,
  csv,
  hiddenColumns = [],
  toolbar,
  onRowClick,
  rowId,
  emptyTitle,
  emptyDescription,
  emptyAction,
  error = null,
  retry,
  compact = false,
}: DataTableProps<T>) {
  // Callers pass the hidden list inline; its contents, not its identity, decide the memo.
  const hiddenKey = hiddenColumns.join("\u0000");
  const initialVisibility = useMemo<VisibilityState>(() => {
    const hidden = new Set(hiddenKey === "" ? [] : hiddenKey.split("\u0000"));
    return Object.fromEntries(
      columns.map((column, index) => {
        const id = columnId(column, index);
        return [id, !hidden.has(id)];
      }),
    );
  }, [columns, hiddenKey]);
  const storageKey = `agentcommons-columns:${label}`;
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
    () => {
      const stored = readVisibility(storageKey);
      return Object.fromEntries(
        Object.entries(initialVisibility).map(([id, shown]) => [
          id,
          stored[id] ?? shown,
        ]),
      );
    },
  );
  useEffect(() => {
    setColumnVisibility((prior) => {
      const missing = Object.entries(initialVisibility).filter(
        ([id]) => !(id in prior),
      );
      return missing.length
        ? { ...prior, ...Object.fromEntries(missing) }
        : prior;
    });
  }, [initialVisibility]);
  const [record, setRecord] = useState<Row<T> | null>(null);
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
    state: { sorting: sorting ?? [], columnVisibility },
    ...(onSortingChange ? { onSortingChange } : {}),
    onColumnVisibilityChange: (updater) => {
      setColumnVisibility((prior) => {
        const next = typeof updater === "function" ? updater(prior) : updater;
        writeVisibility(storageKey, next);
        return next;
      });
    },
    manualSorting: true,
    enableSorting: sorting !== undefined,
    enableSortingRemoval: false,
    getCoreRowModel: getCoreRowModel(),
    ...(rowId ? { getRowId: rowId } : {}),
  });
  const rows = table.getRowModel().rows;
  const exportCsv = async () => {
    if (!csv) return;
    const controller = new AbortController();
    exportController.current = controller;
    setExporting(true);
    setExportError(null);
    try {
      const leaf = table
        .getAllLeafColumns()
        .filter((column) => column.accessorFn !== undefined);
      const source: T[] = [];
      let cursor: string | null = null;
      do {
        const next = await csv.fetchAll(cursor, controller.signal);
        source.push(...next.items);
        cursor = next.cursor;
      } while (cursor !== null && !controller.signal.aborted);
      if (controller.signal.aborted) return;
      downloadBlob(
        csvBlob(
          leaf.map((column) => headerText(column.columnDef, column.id)),
          source.map((row, index) =>
            leaf.map((column) => column.accessorFn?.(row, index)),
          ),
        ),
        csv.name,
      );
    } catch (error) {
      if (!controller.signal.aborted) setExportError(errorMessage(error));
    } finally {
      if (exportController.current === controller) {
        exportController.current = null;
        setExporting(false);
      }
    }
  };
  const hideable = table
    .getAllLeafColumns()
    .filter((column) => column.getCanHide() && column.accessorFn !== undefined);
  const showToolbar = Boolean(toolbar) || hideable.length > 1 || Boolean(csv);
  return (
    <div className="flex flex-col">
      {showToolbar && (
        <div className="flex flex-wrap items-center gap-2 pb-3">
          <div className="flex min-w-0 flex-1 basis-full flex-wrap items-center gap-2 sm:basis-0">
            {toolbar}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {hideable.length > 1 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary" size="sm">
                    <Columns3 aria-hidden />
                    {copy.app.common.columns}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-52">
                  <DropdownMenuLabel>
                    {copy.app.common.columns}
                  </DropdownMenuLabel>
                  {hideable.map((column) => (
                    <DropdownMenuCheckboxItem
                      key={column.id}
                      checked={column.getIsVisible()}
                      onCheckedChange={(checked) => {
                        column.toggleVisibility(checked);
                      }}
                      onSelect={(event) => {
                        event.preventDefault();
                      }}
                    >
                      {headerText(column.columnDef, column.id)}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {csv && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={exporting || data.length === 0}
                  onClick={() => {
                    void exportCsv();
                  }}
                >
                  <Download aria-hidden />
                  {exporting
                    ? copy.app.common.exporting
                    : copy.app.common.export}
                </Button>
                {exporting && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={copy.app.common.cancelExport}
                    onClick={() => {
                      exportController.current?.abort();
                    }}
                  >
                    <X aria-hidden />
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      )}
      {exportError && (
        <Alert variant="danger" className="mb-3">
          {exportError}
        </Alert>
      )}
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        {error !== null && error !== undefined ? (
          <RequestError
            error={error}
            retry={retry}
            className="rounded-none border-0"
          />
        ) : loading && data.length === 0 ? (
          <div className="p-5">
            <LoadingState />
          </div>
        ) : data.length === 0 ? (
          <EmptyState
            compact
            className="rounded-none border-0"
            title={emptyTitle ?? copy.app.common.empty}
            description={emptyDescription ?? copy.app.common.emptyHint}
            action={emptyAction}
          />
        ) : (
          <Table
            aria-label={label}
            aria-busy={loading}
            className={cn("stacked-table", loading && "opacity-60")}
          >
            <TableHeader>
              {table.getHeaderGroups().map((group) => (
                <TableRow key={group.id} className="hover:bg-transparent">
                  {group.headers.map((header) => {
                    const sorted = header.column.getIsSorted();
                    return (
                      <TableHead
                        key={header.id}
                        aria-sort={
                          sorted === "asc"
                            ? "ascending"
                            : sorted === "desc"
                              ? "descending"
                              : undefined
                        }
                        className={cn(compact && "h-9")}
                      >
                        {header.isPlaceholder ? null : header.column.getCanSort() ? (
                          <button
                            type="button"
                            className={cn(
                              "inline-flex cursor-pointer items-center gap-1 rounded hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                              sorted && "text-fg",
                            )}
                            onClick={header.column.getToggleSortingHandler()}
                          >
                            {flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )}
                            {sorted === "asc" ? (
                              <ArrowUp size={12} aria-hidden />
                            ) : sorted === "desc" ? (
                              <ArrowDown size={12} aria-hidden />
                            ) : null}
                          </button>
                        ) : (
                          flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )
                        )}
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-clickable={true}
                  tabIndex={0}
                  onClick={() => {
                    if (onRowClick) onRowClick(row.original);
                    else setRecord(row);
                  }}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      if (onRowClick) onRowClick(row.original);
                      else setRecord(row);
                    }
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      data-label={headerText(
                        cell.column.columnDef,
                        cell.column.id,
                      )}
                      data-actions={
                        cell.column.accessorFn === undefined || undefined
                      }
                      className={cn(compact && "py-1.5")}
                      onClick={(event) => {
                        // Interactive content inside a cell must not also open the row.
                        if (
                          event.target instanceof Element &&
                          event.target.closest(
                            "a,button,input,select,textarea,[role=menuitem]",
                          )
                        )
                          event.stopPropagation();
                      }}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {page && (page.index > 0 || page.hasNext) && (
          <div className="flex items-center justify-between gap-3 border-t border-line-soft px-4 py-2 text-xs text-muted">
            <span>
              {copy.app.common.page} {page.index + 1}
              {copy.app.common.separator}
              {data.length} {copy.app.common.rows}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                disabled={page.index === 0 || loading}
                onClick={page.onPrevious}
              >
                <ChevronLeft aria-hidden />
                {copy.app.common.previous}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={!page.hasNext || loading}
                onClick={page.onNext}
              >
                {copy.app.common.next}
                <ChevronRight aria-hidden />
              </Button>
            </div>
          </div>
        )}
      </div>
      <Dialog
        open={record !== null}
        onOpenChange={(open) => {
          if (!open) setRecord(null);
        }}
      >
        <DialogContent size="lg">
          <DialogHeader title={copy.app.common.details} description={label} />
          {record && (
            <DefinitionList
              columns={2}
              items={record
                .getAllCells()
                .filter((cell) => cell.column.accessorFn !== undefined)
                .map((cell) => ({
                  label: headerText(cell.column.columnDef, cell.column.id),
                  value: flexRender(
                    cell.column.columnDef.cell,
                    cell.getContext(),
                  ),
                }))}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
