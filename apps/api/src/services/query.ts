import { organizationEmbeddingSetting } from "../embeddings/settings.js";
import { ClickHouseError } from "@agentcommons/traces";
import {
  sqlInputSchema,
  sqlOutputSchema,
  utf8Slice,
  type SqlOutput,
} from "@agentcommons/core";
import { guardSql } from "../repositories/sql-guard.js";
import { ServiceError, type ServiceContext } from "./context.js";
import { bytes, wireValue } from "./read-budget.js";
import { readOperation, type ReadDependencies } from "./read-operation.js";

export class QueryService {
  constructor(
    private readonly dependencies: ReadDependencies,
    private readonly embeddings = false,
  ) {}
  execute(context: ServiceContext, input: unknown) {
    return readOperation(
      this.dependencies.audit,
      context,
      { action: "sql", resourceType: "query", detail: input ?? null },
      async (caller) => {
        const parsed = sqlInputSchema.safeParse(input);
        if (!parsed.success)
          throw new ServiceError(
            400,
            "SQL_INVALID_INPUT",
            `${parsed.error.issues.map((issue) => issue.message).join(" ")} Query schema_columns for the available columns.`,
            { position: null },
          );
        const { sql } = parsed.data;
        const validated = guardSql(
          sql,
          this.embeddings &&
            (
              await organizationEmbeddingSetting(
                this.dependencies.prisma,
                caller.organizationId,
                false,
                Boolean(this.dependencies.saas),
              )
            ).enabled,
        );
        const started = performance.now();
        try {
          return await this.dependencies.readers.read(
            caller,
            async (client) => {
              const result = await client.query(`SELECT * FROM (
${validated}
) q LIMIT 501`);
              const output: SqlOutput = {
                columns: result.fields,
                rows: [],
                row_count: 0,
                capped: result.data.length > 500,
                truncated_cells: [],
                duration_ms: 0,
              };
              for (const row of result.data.slice(0, 500)) {
                const truncated: [number, number][] = [];
                const converted = row.map((cell, columnIndex) => {
                  const value = wireValue(cell);
                  const serialized =
                    typeof value === "string"
                      ? value
                      : typeof value === "object" && value !== null
                        ? JSON.stringify(value)
                        : null;
                  if (
                    serialized !== null &&
                    Buffer.byteLength(serialized) > 2048
                  ) {
                    truncated.push([output.rows.length, columnIndex]);
                    return utf8Slice(serialized, 0, 2048).content;
                  }
                  return value;
                });
                output.rows.push(converted);
                output.truncated_cells.push(...truncated);
                output.row_count++;
                if (bytes(output) > 256 * 1024 - 100) {
                  output.rows.pop();
                  output.row_count--;
                  output.truncated_cells.splice(
                    output.truncated_cells.length - truncated.length,
                    truncated.length,
                  );
                  output.capped = true;
                  break;
                }
              }
              output.duration_ms =
                Math.round((performance.now() - started) * 1000) / 1000;
              if (bytes(output) > 256 * 1024)
                throw new ServiceError(
                  400,
                  "SQL_RESULT_TOO_WIDE",
                  "Select fewer columns. The column metadata exceeds the response limit.",
                  { position: null },
                );
              return sqlOutputSchema.parse(output);
            },
          );
        } catch (error) {
          if (error instanceof ServiceError) throw error;
          if (!(error instanceof ClickHouseError))
            throw new ServiceError(
              503,
              "TRACE_QUERY_UNAVAILABLE",
              "The trace database did not complete the query. Try again.",
              { position: null },
            );
          const code = error.code;
          const failure = queryFailures[code];
          if (!failure)
            throw new ServiceError(
              503,
              "TRACE_QUERY_UNAVAILABLE",
              "The trace database did not complete the query. Try again.",
              { position: null },
            );
          throw new ServiceError(
            400,
            code,
            `${failure} Query schema_columns for available columns.`,
            { position: null },
          );
        }
      },
      (result) => ({
        row_count: result.row_count,
        capped: result.capped,
        duration_ms: result.duration_ms,
      }),
    );
  }
}

/** Native errors are classified without returning SQL, parameter values or server details. */
const queryFailures: Readonly<Record<string, string>> = {
  "6": "A query value could not be parsed.",
  "27": "A query value could not be parsed.",
  "36": "A function argument is invalid.",
  "43": "A function received an incompatible value type.",
  "44": "A function requires a constant or a different column type.",
  "47": "A column in this query is unavailable.",
  "53": "The query combines incompatible value types.",
  "60": "A table in this query is unavailable.",
  "62": "The SQL syntax is invalid.",
  "207":
    "A column appears in more than one source. Qualify it with its table alias.",
  "159": "The query exceeded its time limit. Narrow the query and try again.",
  "160": "The query exceeded its time limit. Narrow the query and try again.",
  "179":
    "Different expressions use the same alias. Give each one a unique alias.",
  "184": "An aggregate function is used outside an aggregate expression.",
  "215": "Include the selected column in GROUP BY or an aggregate function.",
  "206": "Give each joined subquery a table alias.",
  "241": "The query exceeded its memory limit. Narrow the query and try again.",
  "396":
    "The query result exceeded its size limit. Select fewer or smaller values.",
  "386": "The query combines value types that cannot share a result column.",
};
