import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "../../lib/api/client";
import type { paths } from "../../lib/api/generated";
import type { keySortKeys } from "../../lib/api/options";
import type { ApiKey, Page } from "../../lib/types";

type KeyQuery = NonNullable<
  paths["/api/v1/me/keys"]["get"]["parameters"]["query"]
>;
type KeySort = (typeof keySortKeys)[number];

export async function fetchKeys(
  query: {
    cursor: string | null;
    limit: number;
    sort: KeySort;
    order: "asc" | "desc";
  },
  signal: AbortSignal | undefined,
): Promise<Page<ApiKey>> {
  const params: KeyQuery = {
    cursor: query.cursor,
    limit: query.limit,
    sort: query.sort,
    order: query.order,
    format: "json",
  };
  const page = unwrap(
    await api.GET("/api/v1/me/keys", {
      params: { query: params },
      ...(signal ? { signal } : {}),
    }),
  );
  return { items: page.items, cursor: page.cursor };
}
const keysQueryKey = (organizationId: string) =>
  [organizationId, "me-keys"] as const;

/** One page of the caller's keys; the keys table and the install guide share the cache prefix. */
export function useKeysPage(
  organizationId: string,
  query: {
    cursor: string | null;
    limit: number;
    sort: KeySort;
    order: "asc" | "desc";
  },
) {
  return useQuery({
    queryKey: [...keysQueryKey(organizationId), query],
    queryFn: ({ signal }) => fetchKeys(query, signal),
  });
}
export async function revokeKey(id: string, reason: string) {
  return unwrap(
    await api.DELETE("/api/v1/me/keys/{id}", {
      params: { path: { id } },
      body: { reason },
    }),
  );
}
/** Refresh every organization-scoped query after a key changes. */
export function useRefreshKeys(organizationId: string) {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: [organizationId] });
}
