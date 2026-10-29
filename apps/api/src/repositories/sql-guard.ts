import { guardTraceSql, TraceSqlError } from "@agentcommons/core/sql";
import { ClickHouseError } from "@agentcommons/traces";
import {
  embeddingsDisabledMessage,
  type EmbeddingAvailability,
} from "../embeddings/settings.js";
import { ServiceError } from "../services/context.js";
import { traceQueryUnavailable, traceReadFailure } from "./read-failure.js";

/** A SQL tool failure; the REST mapper reads `position`, null when no source location applies. */
export function sqlError(
  statusCode: number,
  code: string,
  message: string,
  position: number | null = null,
): ServiceError {
  return new ServiceError(statusCode, code, message, { position });
}

export function guardSql(
  sql: string,
  embeddings: EmbeddingAvailability,
  parameters: Readonly<Record<string, string>> = {},
): string {
  try {
    return guardTraceSql(sql, embeddings.enabled, parameters);
  } catch (error) {
    if (!(error instanceof TraceSqlError)) throw error;
    if (error.capability !== null)
      throw sqlError(
        400,
        "EMBEDDINGS_DISABLED",
        `${embeddingsDisabledMessage(error.capability, embeddings)} Use search_messages(q='words') for keyword search.`,
        error.position,
      );
    throw sqlError(
      400,
      "SQL_REJECTED",
      `${error.message} Query schema_columns for available columns.`,
      error.position,
    );
  }
}

/**
 * Stable codes for a caller's SQL that ClickHouse refused (§7.4), shared by REST
 * `POST /query`, the MCP `sql` tool and dashboard tiles. Limits and availability come from
 * the read classifier every trace read shares; this table names the classes of mistake a
 * caller's own SELECT can make. Native error numbers are never returned and messages never
 * echo SQL or values.
 */
const queryInvalid: Readonly<Record<string, string>> = {
  "6": "A query value could not be parsed.",
  "27": "A query value could not be parsed.",
  "36": "A function argument is invalid.",
  "42": "A function received the wrong number of arguments.",
  "43": "A function received an incompatible value type.",
  "44": "A function requires a constant or a different column type.",
  "46": "A function in this query is unavailable.",
  "47": "A column in this query is unavailable.",
  "53": "The query combines incompatible value types.",
  "60": "A table in this query is unavailable.",
  "62": "The SQL syntax is invalid.",
  "70": "A value cannot be converted to the requested type.",
  "153": "The query divides by zero.",
  "179":
    "Different expressions use the same alias. Give each one a unique alias.",
  "184": "An aggregate function is used outside an aggregate expression.",
  "206": "Give each joined subquery a table alias.",
  "207":
    "A column appears in more than one source. Qualify it with its table alias.",
  "215": "Include the selected column in GROUP BY or an aggregate function.",
  "386": "The query combines value types that cannot share a result column.",
  "456": "A query parameter is missing or has the wrong type.",
  "457": "A query parameter is missing or has the wrong type.",
};
/** A `/query` error keeps the `{ code, message, position }` contract: `position` is null for native errors. */
function withPosition(failure: ServiceError): ServiceError {
  const positioned = new ServiceError(
    failure.statusCode,
    failure.code,
    failure.message,
    {
      ...(typeof failure.detail === "object" &&
      failure.detail !== null &&
      !Array.isArray(failure.detail)
        ? failure.detail
        : {}),
      position: null,
    },
  );
  positioned.cause = failure.cause;
  return positioned;
}
/** Maps a native failure of an executed query to its stable code (§7.4); `ServiceError`s pass through. */
export function queryFailure(error: unknown): ServiceError {
  if (error instanceof ServiceError) return error;
  // A caller's own SELECT outgrowing the memory or result limit is the caller's to narrow (400);
  // the time limit and busy databases stay server conditions through the shared read classifier.
  if (error instanceof ClickHouseError && error.code === "241")
    return sqlError(
      400,
      "QUERY_MEMORY_LIMIT",
      "The query exceeded the per-query memory limit. Narrow it, for message text by filtering search_messages(q='words') or a few literal session_id values, and try again.",
    );
  if (error instanceof ClickHouseError && error.code === "396")
    return sqlError(
      400,
      "QUERY_RESULT_LIMIT",
      "The query result exceeded its size limit. Select fewer or smaller values, or page with LIMIT and OFFSET.",
    );
  const read = traceReadFailure(error);
  if (read) return withPosition(read);
  if (!(error instanceof ClickHouseError))
    return withPosition(traceQueryUnavailable(error));
  const message = queryInvalid[error.code];
  if (message === undefined) {
    const failure = sqlError(
      500,
      "QUERY_FAILED",
      "The query could not be run. Simplify it and try again.",
    );
    failure.cause = error;
    return failure;
  }
  return sqlError(
    400,
    "QUERY_INVALID",
    `${message} Query schema_columns for available columns.`,
  );
}
