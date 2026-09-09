import type { Page } from "@playwright/test";
import type { JsonValue } from "@agentcommons/core/schemas/common";
import { z } from "zod";
const timestampField = /^(?:date|week|timestamp|ts)$|(?:_at|At)$/;
const isoValue = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/;
function translatedDate(value: string, delta: number): string {
  if (!isoValue.test(value)) return value;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const translated = new Date(timestamp + delta).toISOString();
  return value.length === 10 ? translated.slice(0, 10) : translated;
}
/**
 * Objects translate only known timestamp fields. Arrays are SQL result rows whose
 * columns carry no names, so any ISO date or datetime cell is translated.
 */
function translatedResponse(value: JsonValue, delta: number): JsonValue {
  if (Array.isArray(value))
    return value.map((item) =>
      typeof item === "string"
        ? translatedDate(item, delta)
        : translatedResponse(item, delta),
    );
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        typeof item === "string" && timestampField.test(key)
          ? translatedDate(item, delta)
          : translatedResponse(item, delta),
      ]),
    );
  return value;
}
// Only the visual matrix uses this clock bridge. Requests still reach the real
// authenticated API and SQL views. Counts, content, identifiers and cursors are
// untouched; the functional matrix never installs a route interceptor.
export async function installVisualTime(page: Page, timeShiftMs: number) {
  // Sunday keeps the exclusive default date filter after every possible receipt
  // in the current real week, while the transcript dates stay on Monday.
  await page.clock.setFixedTime(new Date("2026-09-13T12:00:00.000Z"));
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    for (const [key, value] of url.searchParams)
      if (/^filters\[date_(?:from|to)\]$/.test(key))
        url.searchParams.set(key, translatedDate(value, timeShiftMs));
    const response = await route.fetch({ url: url.toString() });
    if (!response.headers()["content-type"]?.includes("application/json")) {
      await route.fulfill({ response });
      return;
    }
    const body = z.json().parse(await response.json());
    await route.fulfill({
      response,
      json: translatedResponse(body, -timeShiftMs),
    });
  });
}
