import type { MetricRow } from "@agentcommons/core/schemas/metrics";
import { copy } from "../../copy";
import { number } from "../../lib/display";
import { EmptyState } from "./primitives";
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
  const ordered = [...rows].sort((left, right) =>
    (left.date ?? "").localeCompare(right.date ?? ""),
  );
  const maximum = Math.max(1, ...ordered.map((row) => row.value ?? 0));
  const width = 640;
  const height = 176;
  const step = (width - 32) / Math.max(1, ordered.length);
  return (
    <figure className="metric-plot">
      <figcaption>
        {title}
        {ordered[0] && (
          <span>{copy.workspace.systemStatus.units[ordered[0].unit]}</span>
        )}
      </figcaption>
      {ordered.length === 0 ? (
        <EmptyState title={copy.workspace.systemStatus.empty} />
      ) : (
        <>
          <div className="metric-plot-scale">
            <span>{metricValue(maximum, ordered[0]?.unit ?? "count")}</span>
          </div>
          <svg
            viewBox={`0 0 ${String(width)} ${String(height)}`}
            role="img"
            aria-label={title}
            preserveAspectRatio="none"
          >
            {[0, 0.5, 1].map((line) => (
              <line
                key={line}
                x1={16}
                x2={width - 16}
                y1={12 + line * 144}
                y2={12 + line * 144}
                className="metric-grid-line"
              />
            ))}
            {ordered.map((row, index) => {
              const barHeight = ((row.value ?? 0) / maximum) * 144;
              const label = [
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
                .join(copy.workspace.common.separator);
              return (
                <rect
                  key={index}
                  x={16 + index * step + step * 0.15}
                  y={156 - barHeight}
                  width={Math.max(1, step * 0.7)}
                  height={barHeight}
                  rx={Math.min(3, step * 0.15)}
                  className="metric-bar"
                >
                  <title>
                    {label}
                    {copy.workspace.common.separator}
                    {metricValue(row.value, row.unit)}
                    {row.denominator === null
                      ? ""
                      : ` (${number(row.numerator)} / ${number(row.denominator)})`}
                  </title>
                </rect>
              );
            })}
          </svg>
          <div className="metric-plot-axis">
            <span>{ordered[0]?.date}</span>
            <span>{ordered.at(-1)?.date}</span>
          </div>
        </>
      )}
    </figure>
  );
}
