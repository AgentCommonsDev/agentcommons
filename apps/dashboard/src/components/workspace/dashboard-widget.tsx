import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import type { DashboardDefinition } from "@agentcommons/core/schemas/dashboards";
import { sqlOutputSchema } from "@agentcommons/core/schemas/sql";
import { api, unwrap } from "../../lib/api/client";
import { copy } from "../../copy";
import { useWorkspace } from "./context";
import { LoadingState, RequestError } from "./primitives";
import { SqlResult } from "./sql-result";
import { metricValue } from "./metric-chart";
import { Button } from "../ui/button";
import { textValue } from "../../lib/display";
export function DashboardWidget({
  widget,
}: {
  widget: DashboardDefinition["widgets"][number];
}) {
  const { organization } = useWorkspace();
  const result = useQuery({
    queryKey: [organization.id, "dashboard-widget", widget.sql],
    queryFn: async ({ signal }) =>
      sqlOutputSchema.parse(
        unwrap(
          await api.POST("/api/v1/query", {
            body: { sql: widget.sql },
            signal,
          }),
        ),
      ),
    retry: false,
  });
  const data = result.data;
  const xIndex =
    data?.columns.findIndex((column) => column.name === widget.x) ?? -1;
  const yIndex = widget.y
    ? (data?.columns.findIndex((column) => column.name === widget.y) ?? -1)
    : 0;
  const points =
    data?.rows.map((row) => ({
      label: textValue(row[xIndex]),
      value:
        typeof row[yIndex] === "number"
          ? row[yIndex]
          : typeof row[yIndex] === "string" && row[yIndex].trim() !== ""
            ? Number(row[yIndex])
            : row[yIndex] === null
              ? null
              : Number.NaN,
    })) ?? [];
  const invalid =
    yIndex < 0 ||
    (widget.y !== undefined &&
      data?.columns.filter((column) => column.name === widget.y).length !==
        1) ||
    (widget.x !== undefined &&
      data?.columns.filter((column) => column.name === widget.x).length !==
        1) ||
    (widget.display !== "number" && xIndex < 0) ||
    points.some(
      (point) =>
        point.value !== null &&
        (!Number.isFinite(point.value) ||
          (Number.isInteger(point.value) &&
            !Number.isSafeInteger(point.value))),
    );
  return (
    <section className="dashboard-widget" aria-label={widget.title}>
      <div className="dashboard-widget-heading">
        <h2>{widget.title}</h2>
        <Button
          variant="ghost"
          size="small"
          disabled={result.isFetching}
          onClick={() => {
            void result.refetch();
          }}
        >
          {copy.workspace.common.refresh}
        </Button>
      </div>
      {result.isPending && <LoadingState />}
      {result.error && <RequestError error={result.error} />}
      {data && (
        <>
          {widget.display === "table" ? (
            <SqlResult data={data} />
          ) : invalid ? (
            <p role="alert">{copy.workspace.profiles.columnError}</p>
          ) : widget.display === "number" ? (
            <div className="dashboard-number">
              <strong>
                {metricValue(points[0]?.value ?? null, widget.unit)}
              </strong>
              <span>{copy.workspace.systemStatus.units[widget.unit]}</span>
            </div>
          ) : (
            <div className="dashboard-chart">
              <ResponsiveContainer width="100%" height={260}>
                {widget.display === "line" ? (
                  <LineChart data={points} accessibilityLayer>
                    <CartesianGrid stroke="var(--line)" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: "var(--muted)", fontSize: 11 }}
                    />
                    <YAxis
                      width={64}
                      tickFormatter={(value) =>
                        metricValue(Number(value), widget.unit)
                      }
                      tick={{ fill: "var(--muted)", fontSize: 11 }}
                    />
                    <Tooltip
                      formatter={(value) =>
                        metricValue(Number(value), widget.unit)
                      }
                      contentStyle={{
                        background: "var(--surface)",
                        borderColor: "var(--line)",
                        color: "var(--text)",
                      }}
                    />
                    <Line
                      dataKey="value"
                      name={widget.title}
                      stroke="var(--accent)"
                      isAnimationActive={false}
                    />
                  </LineChart>
                ) : (
                  <BarChart data={points} accessibilityLayer>
                    <CartesianGrid stroke="var(--line)" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: "var(--muted)", fontSize: 11 }}
                    />
                    <YAxis
                      width={64}
                      tickFormatter={(value) =>
                        metricValue(Number(value), widget.unit)
                      }
                      tick={{ fill: "var(--muted)", fontSize: 11 }}
                    />
                    <Tooltip
                      formatter={(value) =>
                        metricValue(Number(value), widget.unit)
                      }
                      contentStyle={{
                        background: "var(--surface)",
                        borderColor: "var(--line)",
                        color: "var(--text)",
                      }}
                    />
                    <Bar
                      dataKey="value"
                      name={widget.title}
                      fill="var(--accent)"
                      isAnimationActive={false}
                    />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          )}
          {widget.display !== "table" && (
            <details className="widget-data">
              <summary>{copy.workspace.profiles.data}</summary>
              <SqlResult data={data} />
            </details>
          )}
        </>
      )}
    </section>
  );
}
