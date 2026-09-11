import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { copy } from "../../copy";
import { useFeature } from "../../lib/use-auth-config";
import { useWorkspace } from "../../components/app/workspace";
import { Button } from "../../components/ui/button";
import { PageHeader } from "../../components/ui/feedback";
import { Input } from "../../components/ui/input";
import { FilterBar, dateToIso } from "../../features/admin/filters";
import {
  HealthMetricsCard,
  InstallationHealSummary,
  InstallationsCard,
  SnapshotCards,
  type MetricFilters,
} from "../../features/admin/status";

interface Range {
  from: string;
  to: string;
  repo: string;
}
/** The last four weeks up to and including today, as UTC calendar days. */
function defaultRange(): Range {
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  end.setUTCDate(end.getUTCDate() + 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 28);
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
    repo: "",
  };
}
const text = copy.admin.status;
export function StatusPage() {
  const { organization } = useWorkspace();
  const client = useQueryClient();
  const embeddings = useFeature("similar_sessions");
  const [defaults] = useState(defaultRange);
  const [draft, setDraft] = useState<Range>(defaults);
  const [applied, setApplied] = useState<Range>(defaults);
  const invalid =
    draft.from === "" || draft.to === "" || draft.from >= draft.to;
  const repo = applied.repo.trim();
  const filters: MetricFilters = {
    date_from: dateToIso(applied.from),
    date_to: dateToIso(applied.to),
    ...(repo ? { repo_name: repo } : {}),
  };
  const set = (key: keyof Range) => (value: string) => {
    setDraft((prior) => ({ ...prior, [key]: value }));
  };
  return (
    <>
      <PageHeader
        title={text.title}
        description={text.description}
        actions={
          <Button
            variant="secondary"
            onClick={() => {
              void client.invalidateQueries({
                queryKey: [organization.id, "admin"],
              });
            }}
          >
            <RefreshCw aria-hidden />
            {copy.app.common.refresh}
          </Button>
        }
      />
      <HealthMetricsCard
        filters={filters}
        toolbar={
          <div className="flex flex-col gap-1.5">
            <FilterBar
              label={text.range}
              activeCount={
                (applied.repo === "" ? 0 : 1) +
                (applied.from === defaults.from && applied.to === defaults.to
                  ? 0
                  : 1)
              }
              summary={text.rangeSummary(applied.from, applied.to)}
              disabled={invalid}
              onApply={() => {
                if (!invalid) setApplied(draft);
              }}
              onClear={() => {
                setDraft(defaults);
                setApplied(defaults);
              }}
              controls={[
                {
                  id: "from",
                  label: text.from,
                  width: "sm:w-40",
                  showLabel: true,
                  render: (props) => (
                    <Input
                      {...props}
                      type="date"
                      title={text.from}
                      required
                      value={draft.from}
                      max={draft.to}
                      onChange={(event) => {
                        set("from")(event.target.value);
                      }}
                    />
                  ),
                },
                {
                  id: "to",
                  label: text.to,
                  width: "sm:w-40",
                  showLabel: true,
                  render: (props) => (
                    <Input
                      {...props}
                      type="date"
                      title={text.to}
                      required
                      value={draft.to}
                      min={draft.from}
                      onChange={(event) => {
                        set("to")(event.target.value);
                      }}
                    />
                  ),
                },
                {
                  id: "repo",
                  label: text.repo,
                  width: "sm:w-64",
                  render: (props) => (
                    <Input
                      {...props}
                      type="search"
                      placeholder={text.repo}
                      title={text.repoHint}
                      value={draft.repo}
                      onChange={(event) => {
                        set("repo")(event.target.value);
                      }}
                    />
                  ),
                },
              ]}
            />
            {invalid && (
              <p role="alert" className="text-xs text-danger">
                {text.invalidRange}
              </p>
            )}
          </div>
        }
      />
      <SnapshotCards embeddings={embeddings} />
      <InstallationHealSummary />
      <InstallationsCard />
    </>
  );
}
