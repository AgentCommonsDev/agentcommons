import type { Completion, CompletionSource } from "@codemirror/autocomplete";
import type { SQLNamespace } from "@codemirror/lang-sql";
import type { schemaOutputSchema } from "@agentcommons/core/schemas/rest";
import { traceSqlFunctions, traceViews } from "@agentcommons/core/sql";
import type { z } from "zod";

export type Schema = z.infer<typeof schemaOutputSchema>;
export type SchemaColumn = Schema["columns"][number];
export type SchemaFunction = Schema["functions"][number];
export interface SchemaView {
  name: string;
  columns: SchemaColumn[];
}

const knownOrder = new Map<string, number>(
  traceViews.map((name, index) => [name, index]),
);
/** Views in canonical order with their columns in ordinal order. */
export function groupViews(schema: Schema | undefined): SchemaView[] {
  const views = new Map<string, SchemaColumn[]>();
  for (const column of schema?.columns ?? [])
    views.set(column.view_name, [
      ...(views.get(column.view_name) ?? []),
      column,
    ]);
  return [...views.entries()]
    .sort(([a], [b]) => {
      const rankA = knownOrder.get(a) ?? Number.MAX_SAFE_INTEGER;
      const rankB = knownOrder.get(b) ?? Number.MAX_SAFE_INTEGER;
      return rankA === rankB ? a.localeCompare(b) : rankA - rankB;
    })
    .map(([name, columns]) => ({
      name,
      columns: [...columns].sort(
        (a, b) => a.ordinal_position - b.ordinal_position,
      ),
    }));
}
/** Vector views only appear in the schema when embeddings are on; the guard needs to know. */
export function hasEmbeddings(views: readonly SchemaView[]): boolean {
  return views.some((view) => view.name === "session_embeddings");
}
/** Table and column completions in the shape @codemirror/lang-sql consumes. */
export function completionNamespace(
  views: readonly SchemaView[],
): SQLNamespace {
  const namespace: Record<
    string,
    { self: Completion; children: Completion[] }
  > = {};
  for (const view of views)
    namespace[view.name] = {
      self: {
        label: view.name,
        type: "type",
        detail: `${String(view.columns.length)} columns`,
        boost: 1,
      },
      children: view.columns.map((column) => ({
        label: column.column_name,
        type: "property",
        detail: column.data_type,
        ...(column.description ? { info: column.description } : {}),
      })),
    };
  return namespace;
}
/** Every function the guard accepts plus the caller's table functions. */
export function functionCompletions(
  functions: readonly SchemaFunction[],
): Completion[] {
  return [
    ...functions.map((fn) => ({
      label: fn.function_name,
      type: "function",
      detail: fn.arguments,
      info: fn.description ?? fn.result_type,
      apply: functionSnippet(fn),
      boost: 2,
    })),
    ...traceSqlFunctions.map((name) => ({ label: name, type: "function" })),
  ];
}
const referencedViews = /\b(?:FROM|JOIN)\s+(?:api_ro\.)?([A-Za-z_]\w*)/gi;
/**
 * Columns of every view named in a FROM or JOIN clause, offered for bare identifiers.
 * @codemirror/lang-sql only completes columns after `view.`; an IDE also completes them
 * in SELECT and WHERE once the query says which views it reads.
 */
export function columnsInScope(views: readonly SchemaView[]): CompletionSource {
  const byName = new Map(views.map((view) => [view.name, view]));
  return (context) => {
    const word = context.matchBefore(/[\w$]+/);
    if (!word || (word.from === word.to && !context.explicit)) return null;
    const before = context.state.sliceDoc(0, word.from);
    if (before.endsWith(".")) return null;
    const referenced = new Set<string>();
    for (const match of context.state.doc
      .toString()
      .matchAll(referencedViews)) {
      const name = match[1];
      if (name && byName.has(name)) referenced.add(name);
    }
    if (referenced.size === 0) return null;
    const seen = new Set<string>();
    const options: Completion[] = [];
    for (const name of referenced)
      for (const column of byName.get(name)?.columns ?? [])
        if (!seen.has(column.column_name)) {
          seen.add(column.column_name);
          options.push({
            label: column.column_name,
            type: "property",
            detail: column.data_type,
            boost: 1,
            ...(column.description
              ? { info: `${name}: ${column.description}` }
              : { info: name }),
          });
        }
    return { from: word.from, options, validFor: /^[\w$]*$/ };
  };
}
/** A call with named placeholders, e.g. search_messages(q=''). */
export function functionSnippet(fn: SchemaFunction): string {
  const parameters = fn.arguments
    .split(",")
    .map((argument) => argument.trim())
    .filter(Boolean)
    .map((argument) => {
      const [name = "", type = ""] = argument
        .split("=")
        .map((part) => part.trim());
      return `${name}=${type === "String" ? "''" : ""}`;
    });
  return `${fn.function_name}(${parameters.join(", ")})`;
}
/** Compact type label for badges; the full type stays in the tooltip. */
export function shortType(type: string): string {
  const nullable = /^Nullable\((.*)\)$/.exec(type);
  const inner = nullable?.[1] ?? type;
  const base = inner
    .replace(/^DateTime64\(.*\)$/, "DateTime64")
    .replace(/^Decimal\d*\(.*\)$/, "Decimal")
    .replace(/^LowCardinality\((.*)\)$/, "$1");
  return nullable ? `${base}?` : base;
}
/** Case-insensitive match on view names, column names and descriptions. */
export function filterViews(
  views: readonly SchemaView[],
  query: string,
): SchemaView[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...views];
  return views.flatMap((view) => {
    if (view.name.toLowerCase().includes(needle)) return [view];
    const columns = view.columns.filter(
      (column) =>
        column.column_name.toLowerCase().includes(needle) ||
        (column.description ?? "").toLowerCase().includes(needle),
    );
    return columns.length ? [{ name: view.name, columns }] : [];
  });
}
export function filterFunctions(
  functions: readonly SchemaFunction[],
  query: string,
): SchemaFunction[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...functions];
  return functions.filter(
    (fn) =>
      fn.function_name.toLowerCase().includes(needle) ||
      (fn.description ?? "").toLowerCase().includes(needle),
  );
}
