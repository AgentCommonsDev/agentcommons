import { useQuery, useQueries } from "@tanstack/react-query";
import { copy } from "../../copy";
import { api, unwrap } from "../../lib/api/client";
import { useWorkspace } from "./context";
import { MetricChart, metricValue } from "./metric-chart";
import { LoadingState, RequestError } from "./primitives";
import { MetricScope } from "./metric-scope";
const guardrailDefinitions = [
  ["health", "capture_coverage"],
  ["usage", "follow_through_rate"],
  ["usage", "zero_result_rate"],
] as const;
export function WeeklyReuse({ repo }: { repo: string }) {
  const { organization } = useWorkspace();
  const monday = new Date();
  monday.setUTCHours(0, 0, 0, 0);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const from = new Date(monday);
  from.setUTCDate(from.getUTCDate() - 49);
  const to = new Date(monday);
  to.setUTCDate(to.getUTCDate() + 7);
  const filters = {
    date_from: from.toISOString(),
    date_to: to.toISOString(),
    ...(repo ? { repo_name: repo } : {}),
  };
  const query = useQuery({
    queryKey: [organization.id, "metrics", "headline", filters],
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET("/api/v1/admin/metrics/{group}", {
          params: {
            path: { group: "reuse" },
            query: {
              filters,
              sort: "date",
              order: "asc",
              limit: 100,
              format: "json",
            },
          },
          signal,
        }),
      ),
  });
  const guardrails = useQueries({
    queries: guardrailDefinitions.map(([group, metric]) => ({
      queryKey: [organization.id, "metrics", "guardrail", metric, filters],
      queryFn: async ({ signal }: { signal: AbortSignal }) => ({
        metric,
        ...unwrap(
          await api.GET("/api/v1/admin/metrics/{group}", {
            params: {
              path: { group },
              query: {
                filters: {
                  ...filters,
                  date_from: monday.toISOString(),
                  metric,
                },
                limit: 100,
                format: "json",
              },
            },
            signal,
          }),
        ),
      }),
    })),
  });
  const items = query.data?.items ?? [];
  return (
    <section
      className="metric-section reuse-headline"
      aria-label={copy.workspace.systemStatus.currentWeek}
    >
      <h2>{copy.workspace.systemStatus.currentWeek}</h2>
      <MetricScope repo={repo} />
      {query.isPending && <LoadingState />}
      {query.error && (
        <RequestError
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
        />
      )}
      {query.data && (
        <>
          <dl className="reuse-values">
            {(["reuse_rate", "cross_user_reuse_rate"] as const).map(
              (metric) => {
                const row = items.find(
                  (item) =>
                    item.metric === metric &&
                    item.date === monday.toISOString().slice(0, 10),
                );
                return (
                  <div key={metric}>
                    <dt>{copy.workspace.systemStatus.metrics[metric]}</dt>
                    <dd>
                      {metricValue(row?.value ?? null, "ratio")}
                      {row?.denominator === 0 && (
                        <p>{copy.workspace.systemStatus.noDenominator}</p>
                      )}
                    </dd>
                  </div>
                );
              },
            )}
          </dl>
          <dl className="reuse-guardrails">
            {guardrails.map((guardrail, index) => {
              const definition = guardrailDefinitions[index];
              if (!definition) return null;
              return (
                <div key={definition[1]}>
                  <dt>{copy.workspace.systemStatus.metrics[definition[1]]}</dt>
                  <dd>
                    {guardrail.isPending && <LoadingState />}
                    {guardrail.error && (
                      <RequestError
                        error={guardrail.error}
                        retry={() => {
                          void guardrail.refetch();
                        }}
                      />
                    )}
                    {guardrail.data &&
                      metricValue(
                        guardrail.data.items[0]?.value ?? null,
                        "ratio",
                      )}
                  </dd>
                </div>
              );
            })}
          </dl>
          <p className="field-hint">
            {copy.workspace.systemStatus.reuseDescription}
          </p>
          <details className="session-details">
            <summary>{copy.workspace.systemStatus.trend}</summary>
            <div className="status-charts">
              {(["reuse_rate", "cross_user_reuse_rate"] as const).map(
                (metric) => (
                  <MetricChart
                    key={metric}
                    title={copy.workspace.systemStatus.metrics[metric]}
                    rows={items.filter((row) => row.metric === metric)}
                  />
                ),
              )}
            </div>
          </details>
        </>
      )}
    </section>
  );
}
