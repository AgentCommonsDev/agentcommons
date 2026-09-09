import { z } from "zod";
import {
  searchConditionSchema,
  searchFiltersSchema,
  type SearchCondition,
  type SearchFilters,
} from "@agentcommons/core/schemas/search";
import {
  fileOperationSchema,
  harnessSchema,
  messageKindSchema,
  messageRoleSchema,
  sessionStatusSchema,
} from "@agentcommons/core/schemas/common";
import { copy } from "../../copy";
import { defined } from "../../lib/api/client";
import { harnessLabel, operationLabel, statusLabel } from "../../lib/display";

/** Quick filters accept several values; the server matches any of them. */
/** Filters as the generated client expects them: optional keys are absent, never undefined. */
export type ApiFilters = ReturnType<typeof defined<SearchFilters>>;
export const valueFilterKeys = [
  "repo_name",
  "branch",
  "user_email",
  "tool_name",
  "file_prefix",
  "file_operation",
  "role",
  "session_id",
] as const;
export type ValueFilterKey = (typeof valueFilterKeys)[number];
export type ResultView = "sessions" | "messages";

export interface SearchState {
  query: string;
  view: ResultView | null;
  values: Partial<Record<ValueFilterKey, string[]>>;
  since: string | null;
  until: string | null;
  where: SearchCondition[];
}
const emptySearchState: SearchState = {
  query: "",
  view: null,
  values: {},
  since: null,
  until: null,
  where: [],
};

// The router parses JSON-looking values, so a typed "123" may arrive as a number.
const text = z.union([z.string(), z.number(), z.boolean()]).transform(String);
const textList = z
  .union([text, z.array(text)])
  .transform((value) => (Array.isArray(value) ? value : [value]))
  .transform((value) => value.filter((item) => item.trim() !== ""));
const conditions = z
  .union([z.string(), z.array(z.unknown())])
  .transform((value, context) => {
    let raw: unknown = value;
    if (typeof value === "string") {
      try {
        raw = JSON.parse(value);
      } catch {
        context.addIssue({ code: "custom", message: "Invalid conditions." });
        return z.NEVER;
      }
    }
    const parsed = z.array(searchConditionSchema).safeParse(raw);
    if (!parsed.success) {
      context.addIssue({ code: "custom", message: "Invalid conditions." });
      return z.NEVER;
    }
    return parsed.data;
  });
const urlSchema = z.looseObject({
  q: text.optional().catch(undefined),
  view: z.enum(["sessions", "messages"]).optional().catch(undefined),
  since: text.optional().catch(undefined),
  until: text.optional().catch(undefined),
  where: conditions.optional().catch(undefined),
  ...Object.fromEntries(
    valueFilterKeys.map((key) => [key, textList.optional().catch(undefined)]),
  ),
});
/** URL search params are the only source of truth for the page, so results are shareable. */
export function parseSearchState(search: unknown): SearchState {
  const parsed = urlSchema.safeParse(search);
  if (!parsed.success) return emptySearchState;
  const data = parsed.data;
  const values: Partial<Record<ValueFilterKey, string[]>> = {};
  for (const key of valueFilterKeys) {
    const list = textList.optional().catch(undefined).parse(data[key]);
    if (list && list.length > 0) values[key] = list;
  }
  return {
    query: data.q ?? "",
    view: data.view ?? null,
    values,
    since: data.since ?? null,
    until: data.until ?? null,
    where: data.where ?? [],
  };
}
export function serializeSearchState(
  state: SearchState,
): Record<string, unknown> {
  const search: Record<string, unknown> = {};
  if (state.query.trim()) search.q = state.query.trim();
  if (state.view) search.view = state.view;
  for (const key of valueFilterKeys) {
    const list = state.values[key];
    if (list && list.length > 0) search[key] = list;
  }
  if (state.since) search.since = state.since;
  if (state.until) search.until = state.until;
  if (state.where.length > 0) search.where = state.where;
  return search;
}
export function hasFilters(state: SearchState): boolean {
  return (
    Object.keys(state.values).length > 0 ||
    state.since !== null ||
    state.until !== null ||
    state.where.length > 0
  );
}
/** The view a shared link opens without an explicit choice: words search messages. */
export function effectiveView(state: SearchState): ResultView {
  return state.view ?? (state.query.trim() ? "messages" : "sessions");
}
/** Build the shared API filter object; invalid values from a hand-edited URL surface as an error. */
export function apiFilters(
  state: SearchState,
): { filters: ApiFilters; error: null } | { filters: null; error: string } {
  const candidate: Record<string, unknown> = { ...state.values };
  if (state.since) candidate.since = state.since;
  if (state.until) candidate.until = state.until;
  if (state.where.length > 0) candidate.where = state.where;
  const parsed = searchFiltersSchema.safeParse(candidate);
  if (!parsed.success)
    return { filters: null, error: copy.sessions.filters.invalidUrl };
  return { filters: defined(parsed.data), error: null };
}
/** Add one value to a quick filter without repeating it. */
export function withValue(
  state: SearchState,
  key: ValueFilterKey,
  value: string,
): SearchState {
  const existing = state.values[key] ?? [];
  return {
    ...state,
    values: { ...state.values, [key]: [...new Set([...existing, value])] },
  };
}

export type Operator = SearchCondition["op"];
export interface FieldSpec {
  /**
   * Name shown to people; also the api_ro column name agents see. `date` and `files`
   * are composite controls that write two quick filters each.
   */
  key: SearchCondition["field"] | "date" | "files" | "session_id";
  /** Quick filter key when "is" adds an exact multi-value filter instead of a condition. */
  quick: ValueFilterKey | null;
  operators: readonly Operator[];
  /** Fixed values come from the shared zod enums, never from database contents. */
  options: readonly string[] | null;
  /** Typeahead source; suggestions come from caller-visible catalog views. */
  suggest: "repos" | "users" | "tools" | null;
  optionLabel: "status" | "harness" | null;
}
const allOperators = ["eq", "contains", "starts_with", "exists"] as const;
const textOperators = ["eq", "contains", "starts_with"] as const;
/** One table drives the filter control; adding a field is one row. */
export const fieldSpecs: readonly FieldSpec[] = [
  {
    key: "date",
    quick: null,
    operators: [],
    options: null,
    suggest: null,
    optionLabel: null,
  },
  {
    key: "files",
    quick: null,
    operators: [],
    options: null,
    suggest: null,
    optionLabel: null,
  },
  {
    key: "title",
    quick: null,
    operators: allOperators,
    options: null,
    suggest: null,
    optionLabel: null,
  },
  {
    key: "repo_name",
    quick: "repo_name",
    operators: textOperators,
    options: null,
    suggest: "repos",
    optionLabel: null,
  },
  {
    key: "branch",
    quick: "branch",
    operators: textOperators,
    options: null,
    suggest: null,
    optionLabel: null,
  },
  {
    key: "user_email",
    quick: "user_email",
    operators: textOperators,
    options: null,
    suggest: "users",
    optionLabel: null,
  },
  {
    key: "status",
    quick: null,
    operators: ["eq"],
    options: sessionStatusSchema.options,
    suggest: null,
    optionLabel: "status",
  },
  {
    key: "harness",
    quick: null,
    operators: ["eq"],
    options: harnessSchema.options,
    suggest: null,
    optionLabel: "harness",
  },
  {
    key: "model",
    quick: null,
    operators: allOperators,
    options: null,
    suggest: null,
    optionLabel: null,
  },
  {
    key: "tool_name",
    quick: "tool_name",
    operators: textOperators,
    options: null,
    suggest: "tools",
    optionLabel: null,
  },
  {
    key: "tool_use_id",
    quick: null,
    operators: textOperators,
    options: null,
    suggest: null,
    optionLabel: null,
  },
  {
    key: "content",
    quick: null,
    operators: ["contains", "starts_with", "eq"],
    options: null,
    suggest: null,
    optionLabel: null,
  },
  {
    key: "role",
    quick: "role",
    operators: ["eq"],
    options: messageRoleSchema.options,
    suggest: null,
    optionLabel: "status",
  },
  {
    key: "kind",
    quick: null,
    operators: ["eq"],
    options: messageKindSchema.options,
    suggest: null,
    optionLabel: "status",
  },
  {
    key: "session_id",
    quick: "session_id",
    operators: ["eq"],
    options: null,
    suggest: null,
    optionLabel: null,
  },
  {
    key: "tool_input",
    quick: null,
    operators: allOperators,
    options: null,
    suggest: null,
    optionLabel: null,
  },
];
/** The recorded file operations a session filter can ask for, from the shared enum. */
export const fileOperations: readonly string[] = fileOperationSchema.options;
/** How a quick filter's chip reads: file paths match by prefix, everything else exactly. */
export const valueFilterOperator: Readonly<Record<ValueFilterKey, Operator>> = {
  repo_name: "eq",
  branch: "eq",
  user_email: "eq",
  tool_name: "eq",
  file_prefix: "starts_with",
  file_operation: "eq",
  role: "eq",
  session_id: "eq",
};
export function fieldSpec(key: FieldSpec["key"]): FieldSpec {
  const spec = fieldSpecs.find((item) => item.key === key);
  if (!spec) throw new Error(`Unknown filter field ${key}`);
  return spec;
}
export function fieldTitle(key: FieldSpec["key"] | ValueFilterKey): string {
  return copy.sessions.filters.fields[key];
}
export function fieldHint(key: FieldSpec["key"]): string {
  return copy.sessions.filters.hints[key];
}
/** A filter value as people read it: enum values get their label, text stays as typed. */
export function valueText(
  key: FieldSpec["key"] | ValueFilterKey,
  value: unknown,
): string {
  if (typeof value !== "string") return JSON.stringify(value);
  if (key === "file_operation") return operationLabel(value);
  const spec = fieldSpecs.find((item) => item.key === key);
  if (spec?.optionLabel === "harness") return harnessLabel(value);
  if (spec?.optionLabel === "status") return statusLabel(value);
  return value;
}
/** Dotted path text to the JSON path array the API expects; numbers stay strings. */
export function parsePath(value: string): string[] | null {
  const parts = value
    .split(".")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  return parts.length > 0 && parts.length <= 8 ? parts : null;
}
/** Local calendar day to the UTC instant the API expects; `end` moves to the next midnight. */
export function dayToIso(day: string, end: boolean): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]) + (end ? 1 : 0),
  );
  return Number.isNaN(date.getTime())
    ? null
    : date.toISOString().replace(/\.\d{3}Z$/, "Z");
}
