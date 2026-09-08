import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { copy } from "../copy";
import { api, unwrap } from "../lib/api/client";
import { number } from "../lib/display";
import { useAuthConfig } from "../lib/use-auth-config";
import { useWorkspace } from "../components/workspace/context";
import {
  LoadingState,
  PageHeading,
  RequestError,
  Field,
} from "../components/workspace/primitives";
import {
  MetricsPanel,
  type MetricsFilters,
} from "../components/workspace/metrics-panel";
import { InstallationRollout } from "../components/workspace/installation-rollout";
import { WeeklyReuse } from "../components/workspace/weekly-reuse";
import { Button } from "../components/ui/button";
function defaultDates() {
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  end.setUTCDate(end.getUTCDate() + 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 56);
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
    repo: "",
  };
}
export function StatusPage() {
  const { organization } = useWorkspace();
  const client = useQueryClient();
  const config = useAuthConfig();
  const embeddings =
    config.data?.features.includes("similar_sessions") ?? false;
  const [draft, setDraft] = useState(defaultDates);
  const [applied, setApplied] = useState(draft);
  const [group, setGroup] = useState<"health" | "usage" | "outcomes">("health");
  const filters: MetricsFilters = {
    date_from: `${applied.from}T00:00:00.000Z`,
    date_to: `${applied.to}T00:00:00.000Z`,
    ...(applied.repo.trim() ? { repo_name: applied.repo.trim() } : {}),
  };
  const query = useQuery({
    queryKey: [organization.id, "status"],
    queryFn: async ({ signal }) =>
      unwrap(await api.GET("/api/v1/admin/status", { signal })),
    refetchInterval: 30_000,
  });
  const data = query.data;
  return (
    <>
      <PageHeading
        title={copy.workspace.systemStatus.title}
        description={copy.workspace.systemStatus.description}
        actions={
          <Button
            variant="secondary"
            onClick={() => {
              void query.refetch();
              void client.invalidateQueries({
                queryKey: [organization.id, "metrics"],
              });
            }}
          >
            <RefreshCw size={15} aria-hidden />
            {copy.workspace.common.refresh}
          </Button>
        }
      />
      {config.error && (
        <RequestError
          error={config.error}
          retry={() => {
            void config.refetch();
          }}
        />
      )}
      <WeeklyReuse repo={applied.repo.trim()} />
      <form
        className="metrics-filters"
        aria-label={copy.workspace.systemStatus.dateFilters}
        onSubmit={(event) => {
          event.preventDefault();
          setApplied({ ...draft });
        }}
      >
        <div className="form-grid">
          <Field label={copy.workspace.systemStatus.dateFrom}>
            {(props) => (
              <input
                {...props}
                type="date"
                required
                max={draft.to}
                value={draft.from}
                onChange={(event) => {
                  setDraft((prior) => ({ ...prior, from: event.target.value }));
                }}
              />
            )}
          </Field>
          <Field label={copy.workspace.systemStatus.dateTo}>
            {(props) => (
              <input
                {...props}
                type="date"
                required
                min={draft.from}
                value={draft.to}
                onChange={(event) => {
                  setDraft((prior) => ({ ...prior, to: event.target.value }));
                }}
              />
            )}
          </Field>
          <Field
            label={copy.workspace.systemStatus.repo}
            hint={copy.workspace.systemStatus.repoHint}
          >
            {(props) => (
              <input
                {...props}
                type="text"
                value={draft.repo}
                onChange={(event) => {
                  setDraft((prior) => ({ ...prior, repo: event.target.value }));
                }}
              />
            )}
          </Field>
        </div>
        <Button type="submit" disabled={draft.from >= draft.to}>
          {copy.workspace.common.apply}
        </Button>
      </form>
      <MetricsPanel key="reuse" group="reuse" filters={filters} />
      <Field label={copy.workspace.systemStatus.group}>
        {(props) => (
          <select
            {...props}
            value={group}
            onChange={(event) => {
              const selected = event.target.value;
              if (
                selected === "health" ||
                selected === "usage" ||
                selected === "outcomes"
              )
                setGroup(selected);
            }}
          >
            {(["health", "usage", "outcomes"] as const).map((value) => (
              <option value={value} key={value}>
                {copy.workspace.systemStatus.groups[value]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <MetricsPanel key={group} group={group} filters={filters} />
      <section className="metric-section">
        <h2>{copy.workspace.systemStatus.snapshot}</h2>
        <p className="field-hint">{copy.workspace.systemStatus.snapshotHint}</p>
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
          <dl className="status-metrics">
            {[
              [copy.workspace.systemStatus.queue, number(data.queue_depth)],
              ...(embeddings
                ? [
                    [
                      copy.workspace.systemStatus.backlog,
                      number(data.embedding_backlog),
                    ],
                    [
                      copy.workspace.systemStatus.tokens,
                      number(data.embedding_daily_tokens),
                    ],
                    [
                      copy.workspace.systemStatus.cost,
                      data.embedding_daily_cost,
                    ],
                  ]
                : []),
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
      <InstallationRollout />
    </>
  );
}
