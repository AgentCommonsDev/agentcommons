import {
  embeddingAvailability,
  type EmbeddingAvailability,
} from "../embeddings/settings.js";
import { ClickHouseError, type TraceParameters } from "@agentcommons/traces";
import {
  jsonByteLength,
  sqlInputSchema,
  sqlLimits,
  sqlOutputSchema,
  truncateUtf8,
  type CallerContext,
  type SqlOutput,
} from "@agentcommons/core";
import type { Prisma } from "@agentcommons/db";
import { guardSql, sqlError } from "../repositories/sql-guard.js";
import { ServiceError, type ServiceContext } from "./context.js";
import { wireValue } from "./read-budget.js";
import { readOperation, type ReadDependencies } from "./read-operation.js";

interface QueryRun {
  sql: string;
  /** Values for declared `{name:Type}` parameters; dashboards derive them from variables. */
  parameters?: TraceParameters;
  /** Declared parameter names and ClickHouse types the guard must accept. */
  parameterTypes?: Readonly<Record<string, string>>;
  /** Availability a caller running several queries resolved once; resolved here when absent. */
  embeddings?: EmbeddingAvailability;
}
interface GuardOptions {
  parameterTypes?: Readonly<Record<string, string>> | undefined;
  /** Resolve availability inside this transaction instead of the pool. */
  client?: Prisma.TransactionClient | undefined;
  embeddings?: EmbeddingAvailability | undefined;
}
/** Longest cell text returned before it is cut. */
const CELL_BYTES = 2048;
/** Slack the row loop leaves for `duration_ms` and `capped` in the serialized result. */
const RESULT_SLACK_BYTES = 100;

export class QueryService {
  constructor(
    private readonly dependencies: ReadDependencies,
    private readonly embeddings = false,
  ) {}
  /** Whether vector functions are available to this caller right now, and if not, why. */
  async embeddingsEnabled(
    caller: CallerContext,
    client: Prisma.TransactionClient = this.dependencies.prisma,
  ): Promise<EmbeddingAvailability> {
    return embeddingAvailability(
      client,
      caller.organizationId,
      this.embeddings,
      Boolean(this.dependencies.saas),
    );
  }
  /** Validate one SELECT with the guard under the caller's current capabilities. */
  async guard(
    caller: CallerContext,
    sql: string,
    options: GuardOptions = {},
  ): Promise<string> {
    return guardSql(
      sql,
      options.embeddings ??
        (await this.embeddingsEnabled(caller, options.client)),
      options.parameterTypes ?? {},
    );
  }
  /** Guard and execute one bounded SELECT under the caller's authority; the SQL tool and dashboards share it. */
  async run(caller: CallerContext, input: QueryRun): Promise<SqlOutput> {
    const validated = await this.guard(caller, input.sql, {
      parameterTypes: input.parameterTypes,
      embeddings: input.embeddings,
    });
    const started = performance.now();
    try {
      return await this.dependencies.readers.read(caller, async (client) => {
        const result = await client.query(
          `SELECT * FROM (
${validated}
) q LIMIT ${String(sqlLimits.rows + 1)}`,
          input.parameters ?? {},
        );
        const output: SqlOutput = {
          columns: result.fields,
          rows: [],
          row_count: 0,
          capped: result.data.length > sqlLimits.rows,
          truncated_cells: [],
          duration_ms: 0,
        };
        // Running size of `output` as compact JSON: the envelope, then each row, each
        // truncated cell, their separating commas, and the digits row_count grows by.
        let bytes = jsonByteLength(output);
        const joined = (items: readonly unknown[], existing: number) =>
          items.reduce<number>(
            (sum, item) => sum + jsonByteLength(item),
            existing ? items.length : Math.max(0, items.length - 1),
          );
        for (const row of result.data.slice(0, sqlLimits.rows)) {
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
              Buffer.byteLength(serialized) > CELL_BYTES
            ) {
              truncated.push([output.rows.length, columnIndex]);
              return truncateUtf8(serialized, CELL_BYTES);
            }
            return value;
          });
          const added =
            joined([converted], output.rows.length) +
            joined(truncated, output.truncated_cells.length) +
            String(output.row_count + 1).length -
            String(output.row_count).length;
          if (bytes + added > sqlLimits.responseBytes - RESULT_SLACK_BYTES) {
            output.capped = true;
            break;
          }
          output.rows.push(converted);
          output.truncated_cells.push(...truncated);
          output.row_count++;
          bytes += added;
        }
        output.duration_ms =
          Math.round((performance.now() - started) * 1000) / 1000;
        if (jsonByteLength(output) > sqlLimits.responseBytes)
          throw sqlError(
            400,
            "SQL_RESULT_TOO_WIDE",
            "Select fewer columns. The column metadata exceeds the response limit.",
          );
        return sqlOutputSchema.parse(output);
      });
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      const code = error instanceof ClickHouseError ? error.code : null;
      const failure = code === null ? undefined : queryFailures[code];
      if (code === null || failure === undefined)
        throw sqlError(
          503,
          "TRACE_QUERY_UNAVAILABLE",
          "The trace database did not complete the query. Try again.",
        );
      throw sqlError(
        400,
        code,
        `${failure} Query schema_columns for available columns.`,
      );
    }
  }
  execute(context: ServiceContext, input: unknown) {
    return readOperation(
      this.dependencies.audit,
      context,
      { action: "sql", resourceType: "query", detail: input ?? null },
      async (caller) => {
        const request = sqlInputSchema.parse(input);
        return this.run(caller, { sql: request.sql });
      },
      {
        describeResult: (result) => ({
          row_count: result.row_count,
          capped: result.capped,
          duration_ms: result.duration_ms,
        }),
      },
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
  "456": "A query parameter is missing or has the wrong type.",
};
