import { useState } from "react";
import type { SortingState, OnChangeFn } from "@tanstack/react-table";
import type { DataTablePage } from "../components/app/data-table";

export function usePagination<Sort extends string>(
  initialSort: Sort,
  allowed: readonly Sort[],
) {
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [sorting, setSorting] = useState<SortingState>([
    { id: initialSort, desc: true },
  ]);
  const reset = () => {
    setCursors([null]);
  };
  const onSortingChange: OnChangeFn<SortingState> = (next) => {
    setSorting(next);
    reset();
  };
  const next = (cursor: string | null) => {
    if (cursor !== null) setCursors((prior) => [...prior, cursor]);
  };
  const previous = () => {
    setCursors((prior) => (prior.length > 1 ? prior.slice(0, -1) : prior));
  };
  return {
    cursor: cursors.at(-1) ?? null,
    pageIndex: cursors.length - 1,
    sorting,
    onSortingChange,
    reset,
    sort: allowed.find((value) => value === sorting[0]?.id) ?? initialSort,
    direction:
      sorting[0]?.desc === false ? ("asc" as const) : ("desc" as const),
    next,
    previous,
    /** The DataTable pager for the page whose next cursor is `nextCursor`. */
    page: (nextCursor: string | null | undefined): DataTablePage => ({
      index: cursors.length - 1,
      hasNext: nextCursor !== null && nextCursor !== undefined,
      onNext: () => {
        next(nextCursor ?? null);
      },
      onPrevious: previous,
    }),
  };
}
