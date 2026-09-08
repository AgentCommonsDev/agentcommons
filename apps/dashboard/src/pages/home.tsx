import { useQuery } from "@tanstack/react-query";
import { DashboardProfiles } from "../components/workspace/dashboard-profiles";
import { useWorkspace } from "../components/workspace/context";
import {
  LoadingState,
  PageHeading,
  RequestError,
} from "../components/workspace/primitives";
import { metricValue } from "../components/workspace/metric-chart";
import { copy } from "../copy";
import { api, unwrap } from "../lib/api/client";
import { number } from "../lib/display";

function BuiltinHome() {
  const { organization } = useWorkspace();
  const query = useQuery({
    queryKey: [organization.id, "home", "summary"],
    queryFn: async ({ signal }) =>
      unwrap(await api.GET("/api/v1/home", { signal })),
  });
  const data = query.data;
  const current = data?.weekly.find((row) => row.week === data.week);
  return (
    <>
      <PageHeading
        title={copy.workspace.home.title}
        description={copy.workspace.home.description}
      />
      {query.isPending && <LoadingState />}
      {query.error && (
        <RequestError
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
        />
      )}
      {data && (
        <>
          <section
            className="home-overview"
            aria-label={copy.workspace.home.currentWeek}
          >
            <div className="home-overview-heading">
              <h2>{copy.workspace.home.currentWeek}</h2>
              <a href="/sessions">{copy.workspace.home.browse}</a>
            </div>
            <dl className="home-summary-grid">
              {[
                [copy.workspace.home.captured, number(current?.sessions)],
                [
                  copy.workspace.home.searchedSessions,
                  number(data.search_adoption.agentcommons_search_sessions),
                ],
                [
                  copy.workspace.home.reusedSessions,
                  number(current?.reuse_sessions),
                ],
                [
                  copy.workspace.home.reuseRate,
                  metricValue(current?.reuse_rate ?? null, "ratio"),
                ],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            {current?.sessions === 0 && (
              <p className="home-empty-hint">
                {copy.workspace.home.getStarted}{" "}
                <a href="/installation">{copy.workspace.home.setupCapture}</a>
              </p>
            )}
          </section>
        </>
      )}
    </>
  );
}

export function HomePage() {
  return (
    <DashboardProfiles>
      <BuiltinHome />
    </DashboardProfiles>
  );
}
