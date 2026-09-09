import { guardTraceSql, TraceSqlError } from "@agentcommons/core/sql";
import {
  embeddingsDisabledMessage,
  type EmbeddingAvailability,
} from "../embeddings/settings.js";
import { ServiceError } from "../services/context.js";

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
