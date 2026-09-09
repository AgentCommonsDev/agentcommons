import { z } from "zod";
import type { MetricUnit } from "@agentcommons/core/schemas/common";
import { copy } from "../copy";

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
const dateOnlyFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
});
const numberFormat = new Intl.NumberFormat();
const compactFormat = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});
const percentFormat = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 1,
});
const usdFormat = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

const unavailable = () => copy.app.common.unavailable;
function parseDate(value: string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
export function dateTime(value: string | null | undefined): string {
  const date = parseDate(value);
  return date ? dateTimeFormat.format(date) : unavailable();
}
export function dateOnly(value: string | null | undefined): string {
  const date = parseDate(value);
  return date ? dateOnlyFormat.format(date) : unavailable();
}
export function relativeTime(
  value: string | null | undefined,
  now: Date = new Date(),
): string {
  const date = parseDate(value);
  if (!date) return unavailable();
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return relative.format(seconds, "second");
  if (abs < 3600) return relative.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), "hour");
  if (abs < 30 * 86_400)
    return relative.format(Math.round(seconds / 86_400), "day");
  return dateOnlyFormat.format(date);
}
export function number(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return unavailable();
  if (typeof value === "number")
    return Number.isFinite(value) ? numberFormat.format(value) : unavailable();
  return /^-?\d+$/.test(value) ? numberFormat.format(BigInt(value)) : value;
}
export function duration(seconds: number | string | null | undefined): string {
  const total = typeof seconds === "string" ? Number(seconds) : seconds;
  if (total === null || total === undefined || !Number.isFinite(total))
    return unavailable();
  // Clock skew between a machine and the server can make a live session's last
  // activity precede its first record; a duration is never negative.
  // Round once, then split with floor so no unit can carry into the next ("2h 60m").
  const whole = Math.max(0, Math.round(total));
  if (whole < 60) return `${String(whole)}s`;
  if (whole < 3600)
    return `${String(Math.floor(whole / 60))}m ${String(whole % 60)}s`;
  const hours = Math.floor(whole / 3600);
  return `${String(hours)}h ${String(Math.floor((whole % 3600) / 60))}m`;
}
/** One formatter for every unit shown in stat tiles, chart axes, tables and metric rows. */
export function metricValue(
  value: number | string | null | undefined,
  unit: MetricUnit,
  options: { compact?: boolean } = {},
): string {
  const numeric =
    typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isFinite(numeric))
    return unavailable();
  switch (unit) {
    case "ratio":
      return percentFormat.format(numeric);
    case "usd":
      return usdFormat.format(numeric);
    case "seconds":
      return duration(numeric);
    case "milliseconds":
      return numeric < 1000
        ? `${String(Math.round(numeric))} ms`
        : duration(numeric / 1000);
    case "tokens":
    case "count":
      return options.compact
        ? compactFormat.format(numeric)
        : numberFormat.format(numeric);
  }
}
export function textValue(value: unknown): string {
  if (value === null || value === undefined || value === "")
    return unavailable();
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  )
    return String(value);
  return JSON.stringify(value);
}
export function errorMessage(error: unknown): string {
  if (error instanceof z.ZodError)
    return error.issues.map((issue) => issue.message).join(" ");
  return error instanceof Error && error.message
    ? error.message
    : copy.app.common.requestFailed;
}
export function harnessLabel(harness: string): string {
  const labels: Record<string, string> = copy.app.harnesses;
  return labels[harness] ?? harness;
}
/** A column or field name as a heading: the shared label, or the name as words. */
export function fieldLabel(field: string): string {
  const labels: Record<string, string> = copy.app.fields;
  const known = labels[field];
  if (known !== undefined) return known;
  const words = field.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
export function statusLabel(status: string): string {
  const labels: Record<string, string> = copy.app.statuses;
  return labels[status] ?? status;
}
const statusColumns = new Set(["status", "visibility", "role", "kind"]);
/**
 * A cell as people read it: the `harness` column shows the coding tool's name and enum
 * columns show their labels, so query results, tiles and charts agree with the rest of
 * the app. Every other column keeps its text.
 */
export function columnValueLabel(column: string, value: string): string {
  if (column === "harness") return harnessLabel(value);
  if (statusColumns.has(column)) return statusLabel(value);
  return value;
}
/** A recorded file operation (read, edit, write, delete) as people see it. */
export function operationLabel(operation: string): string {
  const labels: Record<string, string> =
    copy.sessions.detail.files.operationsLabel;
  return labels[operation] ?? operation;
}
export function truncate(value: string, max = 80): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
