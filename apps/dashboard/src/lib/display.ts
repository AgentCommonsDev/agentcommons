import { z } from "zod";
import type { Harness } from "@agentcommons/core/schemas/common";
import { copy } from "../copy";
const dateFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
const numberFormat = new Intl.NumberFormat();
export function dateTime(value: string | null | undefined): string {
  if (!value) return copy.workspace.common.unavailable;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? copy.workspace.common.unavailable
    : dateFormat.format(date);
}
export function number(value: string | number | null | undefined): string {
  if (value === null || value === undefined)
    return copy.workspace.common.unavailable;
  if (typeof value === "number") return numberFormat.format(value);
  return /^-?\d+$/.test(value) ? numberFormat.format(BigInt(value)) : value;
}
export function textValue(value: unknown): string {
  if (value === null || value === undefined || value === "")
    return copy.workspace.common.unavailable;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}
export function errorMessage(error: unknown): string {
  if (error instanceof z.ZodError)
    return error.issues.map((issue) => issue.message).join(" ");
  return error instanceof Error && error.message
    ? error.message
    : copy.workspace.common.requestFailed;
}

export function harnessLabel(harness: Harness): string {
  return copy.workspace.harnesses[harness];
}
