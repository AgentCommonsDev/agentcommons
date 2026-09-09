import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { z } from "zod";
import {
  dashboardDefinitionSchema,
  dashboardRenderOutputSchema,
  dashboardTileTemplateSchema,
  type Dashboard,
  type DashboardDefinition,
  type DashboardRenderOutput,
  type DashboardSummary,
  type DashboardTileTemplate,
} from "@agentcommons/core/schemas/dashboards";
import { useWorkspace } from "../../components/app/workspace";
import { api, ApiError, defined, unwrap } from "../../lib/api/client";
import { errorMessage } from "../../lib/display";
import {
  cellNumber,
  variablesKey,
  type TileResult,
  type VariableValues,
} from "./model";

const dashboardKeys = {
  all: (organization: string) => [organization, "dashboards"] as const,
  list: (organization: string) => [organization, "dashboards", "list"] as const,
  detail: (organization: string, id: string) =>
    [organization, "dashboards", "detail", id] as const,
  render: (organization: string, scope: string, variables: string) =>
    [organization, "dashboards", "render", scope, variables] as const,
  options: (organization: string, kind: string) =>
    [organization, "dashboards", "options", kind] as const,
};
interface DashboardList {
  items: DashboardSummary[];
  default_id: string;
  templates: DashboardTileTemplate[];
}
export function useDashboardList() {
  const { organization } = useWorkspace();
  return useQuery({
    queryKey: dashboardKeys.list(organization.id),
    queryFn: async ({ signal }): Promise<DashboardList> => {
      const data = unwrap(await api.GET("/api/v1/dashboards", { signal }));
      return {
        items: data.items,
        default_id: data.default_id,
        templates: z.array(dashboardTileTemplateSchema).parse(data.templates),
      };
    },
  });
}
export function useDashboard(id: string | undefined) {
  const { organization } = useWorkspace();
  return useQuery({
    queryKey: dashboardKeys.detail(organization.id, id ?? ""),
    enabled: id !== undefined,
    // A missing dashboard is final; retrying only delays the not-found state.
    retry: (count, error) =>
      count < 1 && !(error instanceof ApiError && error.status === 404),
    queryFn: async ({ signal }): Promise<Dashboard> => {
      const data = unwrap(
        await api.GET("/api/v1/dashboards/{id}", {
          params: { path: { id: id ?? "" } },
          signal,
        }),
      );
      return {
        ...data,
        definition: dashboardDefinitionSchema.parse(data.definition),
      };
    },
  });
}

/** Either a saved dashboard rendered by id or an unsaved definition rendered inline. */
type RenderSource = { id: string } | { definition: DashboardDefinition };
const sourceTiles = (source: RenderSource) =>
  "definition" in source ? source.definition.tiles.length : 1;
async function renderRequest(
  source: RenderSource,
  variables: VariableValues,
  tiles: string[] | undefined,
  signal?: AbortSignal,
  refresh = false,
): Promise<DashboardRenderOutput> {
  const body = defined({
    ...source,
    variables,
    ...(tiles ? { tiles } : {}),
    ...(refresh ? { refresh } : {}),
  });
  const data = unwrap(
    await api.POST("/api/v1/dashboards/render", {
      body,
      ...(signal ? { signal } : {}),
    }),
  );
  return dashboardRenderOutputSchema.parse(data);
}
function mergeTiles(
  previous: DashboardRenderOutput | undefined,
  next: DashboardRenderOutput,
): DashboardRenderOutput {
  if (!previous) return next;
  const replaced = new Map(next.tiles.map((tile) => [tile.id, tile]));
  return {
    ...next,
    tiles: [
      ...previous.tiles.map((tile) => replaced.get(tile.id) ?? tile),
      ...next.tiles.filter(
        (tile) => !previous.tiles.some((entry) => entry.id === tile.id),
      ),
    ],
  };
}
/**
 * One render request for the whole dashboard, keyed by organization, dashboard scope and
 * variable values. Single tiles refresh through the same cache entry.
 */
export function useDashboardData({
  scope,
  source,
  variables,
  enabled = true,
}: {
  scope: string;
  source: RenderSource;
  variables: VariableValues;
  enabled?: boolean;
}) {
  const { organization } = useWorkspace();
  const client = useQueryClient();
  const force = useRef(false);
  const latest = useRef(source);
  latest.current = source;
  const key: QueryKey = dashboardKeys.render(
    organization.id,
    scope,
    variablesKey(variables),
  );
  const query = useQuery({
    queryKey: key,
    enabled: enabled && sourceTiles(source) > 0,
    queryFn: ({ signal }) => {
      // A manual refresh bypasses the server's hour-long render cache once.
      const refresh = force.current;
      force.current = false;
      return renderRequest(
        latest.current,
        variables,
        undefined,
        signal,
        refresh,
      );
    },
  });
  const [refreshing, setRefreshing] = useState<ReadonlySet<string>>(new Set());
  const refreshTile = useCallback(
    async (id: string, override?: DashboardDefinition): Promise<TileResult> => {
      setRefreshing((prior) => new Set([...prior, id]));
      try {
        const source = override ? { definition: override } : latest.current;
        const output = await renderRequest(
          source,
          variables,
          [id],
          undefined,
          true,
        );
        client.setQueryData<DashboardRenderOutput>(key, (previous) =>
          mergeTiles(previous, output),
        );
        return (
          output.tiles.find((tile) => tile.id === id) ?? {
            id,
            result: null,
            error: null,
          }
        );
      } catch (error) {
        const failed: TileResult = {
          id,
          result: null,
          error: {
            code: error instanceof ApiError ? error.code : "request_failed",
            message: errorMessage(error),
          },
        };
        client.setQueryData<DashboardRenderOutput>(key, (previous) =>
          previous
            ? mergeTiles(previous, { ...previous, tiles: [failed] })
            : {
                tiles: [failed],
                variables: {},
                rendered_at: new Date().toISOString(),
                cached: false,
              },
        );
        return failed;
      } finally {
        setRefreshing((prior) => {
          const next = new Set(prior);
          next.delete(id);
          return next;
        });
      }
    },
    [client, key, variables],
  );
  const results = new Map<string, TileResult>(
    (query.data?.tiles ?? []).map((tile) => [tile.id, tile]),
  );
  return {
    results,
    renderedAt: query.data?.rendered_at,
    pending: query.isPending && query.fetchStatus !== "idle",
    fetching: query.isFetching,
    error: query.error,
    refreshing,
    refreshTile,
    refreshAll: () => {
      force.current = true;
      return query.refetch();
    },
    invalidate: () => client.invalidateQueries({ queryKey: key }),
  };
}

type SaveInput = {
  id?: string;
  revision?: number;
  name: string;
  description: string;
  definition: DashboardDefinition;
};
export function useSaveDashboard() {
  const { organization } = useWorkspace();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveInput): Promise<Dashboard> => {
      const data = unwrap(
        await api.POST("/api/v1/dashboards", { body: defined(input) }),
      );
      return {
        ...data,
        definition: dashboardDefinitionSchema.parse(data.definition),
      };
    },
    onSuccess: async (saved) => {
      client.setQueryData(
        dashboardKeys.detail(organization.id, saved.id),
        saved,
      );
      await client.invalidateQueries({
        queryKey: dashboardKeys.all(organization.id),
      });
    },
  });
}
export function useDeleteDashboard() {
  const { organization } = useWorkspace();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      unwrap(
        await api.DELETE("/api/v1/dashboards/{id}", {
          params: { path: { id } },
          body: {},
        }),
      ),
    onSuccess: () =>
      client.invalidateQueries({
        queryKey: dashboardKeys.all(organization.id),
      }),
  });
}
export interface ListOption {
  value: string;
  count: number | null;
}
const optionQueries = {
  repo: "SELECT repo_name, session_count FROM repos ORDER BY session_count DESC LIMIT 200",
  user: "SELECT email FROM users ORDER BY email LIMIT 200",
} as const;
/** Options for repository and user variables come from the caller-visible SQL views. */
export function useVariableOptions(
  kind: keyof typeof optionQueries,
  enabled: boolean,
) {
  const { organization } = useWorkspace();
  return useQuery({
    queryKey: dashboardKeys.options(organization.id, kind),
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async ({ signal }): Promise<ListOption[]> => {
      const data = unwrap(
        await api.POST("/api/v1/query", {
          body: { sql: optionQueries[kind] },
          signal,
        }),
      );
      return data.rows.flatMap((row) => {
        const value = row[0];
        return typeof value === "string" && value.length > 0
          ? [{ value, count: cellNumber(row[1]) }]
          : [];
      });
    },
  });
}
export const errorCode = (error: unknown): string | null =>
  error instanceof ApiError ? error.code : null;
