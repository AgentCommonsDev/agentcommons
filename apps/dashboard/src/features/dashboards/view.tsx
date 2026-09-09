import { copy } from "../../copy";
import { relativeTime } from "../../lib/display";
import { paths } from "../../lib/routes";
import { LoadingState, RequestError } from "../../components/app/states";
import { Button } from "../../components/ui/button";
import { Alert, EmptyState } from "../../components/ui/feedback";
import {
  errorCode,
  useDashboard,
  useDashboardData,
  useDashboardList,
} from "./api";
import { DashboardGrid } from "./grid";
import { DashboardHeader } from "./header";
import { cellNumber } from "./model";
import { DashboardTileCard } from "./tiles";
import { useVariableState } from "./use-variables";
import { VariablesBar } from "./variables";

/** Read-only rendering of one dashboard: header, variables bar and the tile grid. */
export function DashboardView({ id }: { id: string }) {
  const list = useDashboardList();
  const dashboard = useDashboard(id);
  if (dashboard.isPending || list.isPending) return <LoadingState />;
  if (dashboard.error) {
    if (errorCode(dashboard.error) === "DASHBOARD_NOT_FOUND")
      return (
        <EmptyState
          title={copy.dashboards.notFound}
          action={
            <Button asChild variant="secondary">
              <a href={paths.home}>{copy.app.navigation.backHome}</a>
            </Button>
          }
        />
      );
    return (
      <RequestError
        error={dashboard.error}
        retry={() => {
          void dashboard.refetch();
        }}
      />
    );
  }
  if (list.error)
    return (
      <RequestError
        error={list.error}
        retry={() => {
          void list.refetch();
        }}
      />
    );
  return <LoadedDashboard dashboard={dashboard.data} list={list.data} />;
}
function LoadedDashboard({
  dashboard,
  list,
}: {
  dashboard: NonNullable<ReturnType<typeof useDashboard>["data"]>;
  list: NonNullable<ReturnType<typeof useDashboardList>["data"]>;
}) {
  const { definition } = dashboard;
  const { values, setVariable } = useVariableState(definition.variables);
  const data = useDashboardData({
    scope: dashboard.id,
    source: { id: dashboard.id },
    variables: values,
  });
  const captured = data.results.get("captured_sessions")?.result;
  const noSessions =
    dashboard.builtin &&
    captured !== undefined &&
    captured !== null &&
    (captured.rows.length === 0 || cellNumber(captured.rows[0]?.[0]) === 0);
  return (
    <div className="flex flex-col gap-4">
      <DashboardHeader
        dashboards={list.items}
        dashboard={dashboard}
        defaultId={list.default_id}
        onRefresh={() => {
          void data.refreshAll();
        }}
        refreshing={data.fetching}
      />
      <VariablesBar
        variables={definition.variables}
        values={values}
        onChange={setVariable}
      />
      {noSessions && (
        <Alert
          variant="info"
          title={copy.dashboards.status.noSessions}
          action={
            <Button asChild size="sm" variant="primary">
              <a href={paths.install}>{copy.dashboards.status.install}</a>
            </Button>
          }
        >
          {copy.dashboards.status.noSessionsHint}
        </Alert>
      )}
      {data.error !== null && (
        <RequestError
          error={data.error}
          retry={() => {
            void data.refreshAll();
          }}
        />
      )}
      <DashboardGrid
        tiles={definition.tiles}
        editing={false}
        renderTile={(tile) => (
          <DashboardTileCard
            tile={tile}
            result={data.results.get(tile.id)}
            loading={data.pending}
            refreshing={data.refreshing.has(tile.id)}
            editing={false}
            onRefresh={() => {
              void data.refreshTile(tile.id);
            }}
            variables={definition.variables}
            values={values}
            onVariableChange={setVariable}
          />
        )}
      />
      {data.renderedAt && (
        <p className="text-xs text-subtle">
          {copy.dashboards.status.rendered} {relativeTime(data.renderedAt)}
        </p>
      )}
    </div>
  );
}
