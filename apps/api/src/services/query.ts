import {
  sqlInputSchema,
  sqlOutputSchema,
  utf8Slice,
  type SqlOutput,
} from "@agentcommons/core";
import { z } from "zod";
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
        const validated = guardSql(sql, this.embeddings);
        const wrapperPrefix = "SELECT * FROM (";
        const sourceOffset = Array.from(
          sql.slice(0, sql.indexOf(validated)),
        ).length;
        const statementLength = Array.from(validated).length;
        const started = performance.now();
        try {
          return await this.dependencies.readers.read(
            caller,
            async (client) => {
              const result = await client.query<unknown[]>({
                text: `${wrapperPrefix}${validated}) q LIMIT 501`,
                rowMode: "array",
              });
              const types = await client.query<{
                oid: number;
                typname: string;
              }>(
                "SELECT oid, typname FROM pg_catalog.pg_type WHERE oid = ANY($1::oid[])",
                [result.fields.map((field) => field.dataTypeID)],
              );
              const typeNames = new Map(
                types.rows.map((row) => [row.oid, row.typname]),
              );
              const output: SqlOutput = {
                columns: result.fields.map((field) => ({
                  name: field.name,
                  type:
                    typeNames.get(field.dataTypeID) ?? String(field.dataTypeID),
                })),
                rows: [],
                row_count: 0,
                capped: result.rows.length > 500,
                truncated_cells: [],
                duration_ms: 0,
              };
              for (const row of result.rows.slice(0, 500)) {
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
          const pg = z
            .object({
              code: z.string().optional(),
              position: z.string().optional(),
            })
            .safeParse(error);
          const code = pg.success ? (pg.data.code ?? "SQL_ERROR") : "SQL_ERROR";
          const position =
            pg.success && pg.data.position ? Number(pg.data.position) : null;
          throw new ServiceError(
            400,
            code,
            code === "57014"
              ? "The query exceeded five seconds. Narrow the query and try again. Query schema_columns for the available columns."
              : "The query could not be executed. Query schema_columns for the available columns.",
            {
              position:
                position !== null && Number.isFinite(position)
                  ? position > wrapperPrefix.length &&
                    position <= wrapperPrefix.length + statementLength
                    ? position - wrapperPrefix.length + sourceOffset
                    : null
                  : null,
            },
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
