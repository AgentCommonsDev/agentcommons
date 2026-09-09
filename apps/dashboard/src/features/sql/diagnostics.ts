import { guardTraceSql, TraceSqlError } from "@agentcommons/core/sql";

/** One problem in the query text with a 0-based range and 1-based line/column. */
export interface SqlProblem {
  from: number;
  to: number;
  line: number;
  column: number;
  message: string;
  /** The vector view or function the query used while embeddings are off; null for syntax problems. */
  capability: string | null;
}
function lineColumn(
  sql: string,
  offset: number,
): { line: number; column: number } {
  const before = sql.slice(0, offset);
  const lines = before.split("\n");
  const last = lines.at(-1) ?? "";
  return { line: lines.length, column: last.length + 1 };
}
/** Turn a 1-based guard position (or none) into a range that covers the token at that point. */
export function problemAt(
  sql: string,
  position: number | null,
  message: string,
  capability: string | null = null,
): SqlProblem {
  const length = sql.length;
  const from =
    position === null
      ? Math.max(0, length - 1)
      : Math.min(Math.max(0, position - 1), Math.max(0, length - 1));
  const token = /^[\w$.]+/.exec(sql.slice(from))?.[0];
  const to = Math.min(length, Math.max(from + 1, from + (token?.length ?? 1)));
  return { from, to, ...lineColumn(sql, from), message, capability };
}
/**
 * The same guard the query service applies, run locally as the user types. Empty text
 * is fine; anything the server would reject is reported with its position.
 */
export function diagnose(sql: string, embeddings: boolean): SqlProblem[] {
  if (!sql.trim()) return [];
  try {
    guardTraceSql(sql, embeddings);
    return [];
  } catch (error) {
    if (error instanceof TraceSqlError)
      return [problemAt(sql, error.position, error.message, error.capability)];
    return [
      problemAt(
        sql,
        null,
        error instanceof Error ? error.message : String(error),
      ),
    ];
  }
}
