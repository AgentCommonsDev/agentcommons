import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { usePagination } from "../../lib/pagination";
import type { Page } from "../../lib/types";
import { without } from "./filters";

interface ListRequest<Sort extends string, Filters extends object> {
  cursor: string | null;
  sort: Sort;
  order: "asc" | "desc";
  limit: number;
  filters: Filters;
}
/**
 * One server-paginated list: applied filters, cursor stack, sort state, the current page
 * query and the props the DataTable needs, including a CSV exporter that walks every page.
 * Changing the filters starts the cursor stack over. `Result` is the page the server
 * returns, so a list whose pages carry totals keeps them typed on `query.data`.
 */
export function useListPage<
  T,
  Sort extends string,
  Filters extends object = Record<string, never>,
  Result extends Page<T> = Page<T>,
>({
  queryKey,
  initialSort,
  sortKeys,
  fetchPage,
  csvName,
  initialFilters,
  enabled = true,
  refetchInterval,
}: {
  queryKey: readonly unknown[];
  initialSort: Sort;
  sortKeys: readonly Sort[];
  fetchPage: (
    request: ListRequest<Sort, Filters>,
    signal: AbortSignal,
  ) => Promise<Result>;
  csvName: string;
  initialFilters?: Filters;
  enabled?: boolean;
  refetchInterval?: number;
}) {
  const pagination = usePagination(initialSort, sortKeys);
  const [filters, setFilterState] = useState<Filters>(
    () => initialFilters ?? ({} as Filters),
  );
  const setFilters = (next: Filters) => {
    setFilterState(next);
    pagination.reset();
  };
  const query = useQuery({
    queryKey: [
      ...queryKey,
      filters,
      pagination.cursor,
      pagination.sort,
      pagination.direction,
    ],
    queryFn: ({ signal }) =>
      fetchPage(
        {
          cursor: pagination.cursor,
          sort: pagination.sort,
          order: pagination.direction,
          limit: 50,
          filters,
        },
        signal,
      ),
    placeholderData: keepPreviousData,
    enabled,
    ...(refetchInterval === undefined ? {} : { refetchInterval }),
  });
  const items = query.data?.items ?? [];
  return {
    query,
    items,
    filters,
    setFilters,
    /** Set or, with `undefined`, drop one filter key so the rest stay exact for the API. */
    setFilter: <K extends keyof Filters>(
      key: K,
      value: Filters[K] | undefined,
    ) => {
      setFilters(
        value === undefined
          ? (without(filters, key) as Filters)
          : { ...filters, [key]: value },
      );
    },
    table: {
      data: items,
      sorting: pagination.sorting,
      onSortingChange: pagination.onSortingChange,
      loading: query.isPending || query.isFetching,
      error: query.error,
      retry: () => {
        void query.refetch();
      },
      page: pagination.page(query.data?.cursor),
      csv: {
        name: csvName,
        fetchAll: (cursor: string | null, signal: AbortSignal) =>
          fetchPage(
            {
              cursor,
              sort: pagination.sort,
              order: pagination.direction,
              limit: 100,
              filters,
            },
            signal,
          ),
      },
    },
  };
}
