import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { usePagination } from "../../lib/pagination";
import type { Page } from "../../lib/types";

interface ListRequest<Sort extends string> {
  cursor: string | null;
  sort: Sort;
  order: "asc" | "desc";
  limit: number;
}
/**
 * One server-paginated list: cursor stack, sort state, the current page query and the
 * props the DataTable needs, including a CSV exporter that walks every page.
 */
export function useListPage<T, Sort extends string>({
  queryKey,
  initialSort,
  sortKeys,
  fetchPage,
  csvName,
  enabled = true,
  refetchInterval,
}: {
  queryKey: readonly unknown[];
  initialSort: Sort;
  sortKeys: readonly Sort[];
  fetchPage: (
    request: ListRequest<Sort>,
    signal: AbortSignal,
  ) => Promise<Page<T>>;
  csvName: string;
  enabled?: boolean;
  refetchInterval?: number;
}) {
  const pagination = usePagination(initialSort, sortKeys);
  const query = useQuery({
    queryKey: [
      ...queryKey,
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
        },
        signal,
      ),
    placeholderData: keepPreviousData,
    enabled,
    ...(refetchInterval === undefined ? {} : { refetchInterval }),
  });
  const items = query.data?.items ?? [];
  const nextCursor = query.data?.cursor ?? null;
  return {
    query,
    items,
    /** Call after the filters change so the cursor stack starts over. */
    reset: pagination.reset,
    table: {
      data: items,
      sorting: pagination.sorting,
      onSortingChange: pagination.onSortingChange,
      loading: query.isPending || query.isFetching,
      page: {
        index: pagination.pageIndex,
        hasNext: nextCursor !== null,
        onNext: () => {
          pagination.next(nextCursor);
        },
        onPrevious: pagination.previous,
      },
      csv: {
        name: csvName,
        fetchAll: (cursor: string | null, signal: AbortSignal) =>
          fetchPage(
            {
              cursor,
              sort: pagination.sort,
              order: pagination.direction,
              limit: 100,
            },
            signal,
          ),
      },
    },
  };
}
