import { guardTraceSql, TraceSqlError } from "@agentcommons/core/sql";
import { ServiceError } from "../services/context.js";

export function guardSql(sql: string, embeddings = false): string {
  try {
    return guardTraceSql(sql, embeddings);
  } catch (error) {
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
