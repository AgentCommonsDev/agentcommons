import { copy } from "../../copy";

export function MetricScope({ repo }: { repo?: string }) {
  return (
    <p className="field-hint metric-scope">
      {copy.workspace.systemStatus.repoScope}{" "}
      <strong>{repo || copy.workspace.systemStatus.allRepos}</strong>
    </p>
  );
}
