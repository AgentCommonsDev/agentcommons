import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import {
  BarChart,
  GaugeChart,
  HeatmapChart,
  LineChart,
  PieChart,
  ScatterChart,
} from "echarts/charts";
import {
  DataZoomComponent,
  DatasetComponent,
  GridComponent,
  LegendComponent,
  PolarComponent,
  TooltipComponent,
  TransformComponent,
  VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsCoreOption } from "echarts/core";
import { useTheme } from "../../lib/theme";
import { cn } from "../../lib/utils";

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  GaugeChart,
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DatasetComponent,
  TransformComponent,
  DataZoomComponent,
  VisualMapComponent,
  PolarComponent,
  CanvasRenderer,
]);

const cssVar = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();
/** Chart palette derived from the site's design tokens; one look for every chart. */
function chartPalette(): string[] {
  return [
    "--chart-1",
    "--chart-2",
    "--chart-3",
    "--chart-4",
    "--chart-5",
    "--chart-6",
  ]
    .map(cssVar)
    .filter(Boolean);
}
function chartTheme(): Record<string, unknown> {
  const text = cssVar("--text");
  const muted = cssVar("--muted");
  const line = cssVar("--line");
  const soft = cssVar("--line-soft");
  const surface = cssVar("--surface");
  const axis = {
    axisLine: { lineStyle: { color: line } },
    axisTick: { show: false },
    axisLabel: { color: muted, fontSize: 11 },
    splitLine: { lineStyle: { color: soft } },
    nameTextStyle: { color: muted },
  };
  return {
    color: chartPalette(),
    backgroundColor: "transparent",
    textStyle: {
      color: text,
      fontFamily: cssVar("--font-sans"),
      fontSize: 12,
    },
    title: { textStyle: { color: text } },
    legend: {
      textStyle: { color: muted, fontSize: 11 },
      icon: "circle",
      itemWidth: 8,
      itemHeight: 8,
    },
    tooltip: {
      backgroundColor: surface,
      borderColor: line,
      textStyle: { color: text, fontSize: 12 },
      extraCssText:
        "box-shadow: 0 12px 30px rgb(0 0 0 / 20%); border-radius: 8px;",
    },
    categoryAxis: axis,
    valueAxis: axis,
    timeAxis: axis,
    logAxis: axis,
    line: { symbolSize: 5, lineStyle: { width: 2 } },
    bar: { itemStyle: { borderRadius: [3, 3, 0, 0] } },
    pie: { itemStyle: { borderColor: surface, borderWidth: 2 } },
    gauge: { axisLine: { lineStyle: { color: [[1, soft]] } } },
  };
}
/** Themes register once per mode; the tokens are read when a mode is first used. */
const registered = new Map<"dark" | "light", string>();
function themeName(mode: "dark" | "light"): string {
  const known = registered.get(mode);
  if (known) return known;
  const name = `agentcommons-${mode}`;
  echarts.registerTheme(name, chartTheme());
  registered.set(mode, name);
  return name;
}
/**
 * Thin ECharts host: sizes to its container, follows the app theme and re-renders on option
 * changes. Options are plain JSON, so nothing executable can be injected through a dashboard.
 */
export function EChart({
  option,
  className,
  onReady,
}: {
  option: EChartsCoreOption;
  className?: string | undefined;
  onReady?: ((chart: echarts.ECharts) => void) | undefined;
}) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const latest = useRef(option);
  latest.current = option;
  const { theme } = useTheme();
  // A theme change re-creates the chart: ECharts fixes its theme at init time.
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const instance = echarts.init(element, themeName(theme), {
      renderer: "canvas",
    });
    instance.setOption(latest.current, { notMerge: true });
    chart.current = instance;
    onReady?.(instance);
    const observer = new ResizeObserver(() => {
      instance.resize();
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, [theme]);
  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true });
  }, [option]);
  return <div ref={host} className={cn("h-full min-h-40 w-full", className)} />;
}
