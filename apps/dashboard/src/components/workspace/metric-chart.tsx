import type { MetricRow } from "@agentcommons/core/schemas/metrics";
import { copy } from "../../copy";
import { number } from "../../lib/display";
import { EmptyState, ShortenedFields } from "./primitives";
export function metricValue(
  value: number | null,
  unit: MetricRow["unit"],
): string {
  if (value === null) return copy.workspace.common.unavailable;
  return new Intl.NumberFormat(
    undefined,
    unit === "ratio"
      ? { style: "percent", maximumFractionDigits: 1 }
      : unit === "usd"
        ? { style: "currency", currency: "USD", maximumFractionDigits: 4 }
        : { maximumFractionDigits: 2 },
  ).format(value);
}
export function MetricChart({
  title,
  rows,
}: {
  title: string;
  rows: MetricRow[];
}) {
  const maximum = Math.max(1, ...rows.map((row) => row.value ?? 0));
  return (
    <figure className="activity-chart metric-chart">
      <figcaption>
        {title}
        {rows[0] && (
          <span className="chart-unit">
            {copy.workspace.systemStatus.units[rows[0].unit]}
          </span>
        )}
      </figcaption>
      {rows.length === 0 ? (
        <EmptyState title={copy.workspace.systemStatus.empty} />
      ) : (
        <ol>
          {rows.map((row, index) => (
            <li key={index}>
              <span>
                {[
                  row.date,
                  row.repo_name,
                  row.harness,
                  row.user_id,
                  row.tool,
                  row.policy_id,
                  row.tools_enabled === null
                    ? null
                    : row.tools_enabled
                      ? copy.workspace.systemStatus.toolsEnabled
                      : copy.workspace.systemStatus.toolsDisabled,
                ]
                  .filter(Boolean)
                  .join(" · ") || copy.workspace.common.all}
              </span>
              <div aria-hidden>
                <span
                  style={{
                    width: `${String(((row.value ?? 0) / maximum) * 100)}%`,
                  }}
                />
              </div>
              <strong>
                {metricValue(row.value, row.unit)}
                {row.denominator !== null && (
                  <small>
                    {number(row.numerator)}
                    {copy.workspace.systemStatus.ratioSeparator}
                    {number(row.denominator)}
                  </small>
                )}
              </strong>
              {row.truncated_fields.length > 0 && (
                <ShortenedFields fields={row.truncated_fields} />
              )}
            </li>
          ))}
        </ol>
      )}
    </figure>
  );
}
