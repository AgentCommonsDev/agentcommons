import { guardTraceSql, TraceSqlError } from "@agentcommons/core/sql";
import {
  embeddingsDisabledMessage,
  embeddingsUnavailable,
  type EmbeddingAvailability,
} from "../embeddings/settings.js";
import { ServiceError } from "../services/context.js";

export function guardSql(
  sql: string,
  embeddings: EmbeddingAvailability = embeddingsUnavailable,
  parameters: Readonly<Record<string, string>> = {},
): string {
  try {
    return guardTraceSql(sql, embeddings.enabled, parameters);
  } catch (error) {
    if (error instanceof TraceSqlError && error.capability !== null)
      throw new ServiceError(
        400,
        "EMBEDDINGS_DISABLED",
        `${embeddingsDisabledMessage(error.capability, embeddings)} Use search_messages(q='words') for keyword search.`,
        { position: error.position },
      );
    if (error instanceof TraceSqlError)
      throw new ServiceError(
        400,
        "SQL_REJECTED",
        `${error.message} Query schema_columns for available columns.`,
        { position: error.position },
      );
    throw error;
  }
}
