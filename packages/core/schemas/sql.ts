import { z } from "zod";
import {
  byteBoundedString,
  jsonValueSchema,
  nonnegativeIntegerSchema,
  responseBytes,
} from "./common.js";

/** Bounds the query service enforces on one SQL run; the guard, the schema and the schema reference read them here. */
export const sqlLimits = {
  /** UTF-8 bytes of the submitted statement. */
  sqlBytes: 20 * 1024,
  /** Rows returned before the result is capped. */
  rows: 500,
  /** Bytes of the serialized result. */
  responseBytes: responseBytes.page,
  /** Wall-clock seconds before ClickHouse stops the query. */
  seconds: 5,
} as const;

export const sqlInputSchema = z.strictObject({
  sql: byteBoundedString(sqlLimits.sqlBytes).refine(
    (value) => value.trim().length > 0,
    { error: "Enter a SELECT query." },
  ),
});
export const sqlOutputSchema = z
  .strictObject({
    columns: z.array(z.strictObject({ name: z.string(), type: z.string() })),
    rows: z.array(z.array(jsonValueSchema)).max(sqlLimits.rows),
    row_count: nonnegativeIntegerSchema.max(sqlLimits.rows),
    capped: z.boolean(),
    truncated_cells: z.array(
      z.tuple([nonnegativeIntegerSchema, nonnegativeIntegerSchema]),
    ),
    duration_ms: z.number().nonnegative(),
  })
  .superRefine((result, context) => {
    if (result.row_count !== result.rows.length)
      context.addIssue({
        code: "custom",
        path: ["row_count"],
        message: "The row count must match the returned rows.",
      });
    if (result.rows.some((row) => row.length !== result.columns.length))
      context.addIssue({
        code: "custom",
        path: ["rows"],
        message: "Each row must match the returned columns.",
      });
    if (
      result.truncated_cells.some(
        ([row, col]) =>
          row >= result.rows.length || col >= result.columns.length,
      )
    )
      context.addIssue({
        code: "custom",
        path: ["truncated_cells"],
        message: "Truncated cells must refer to returned cells.",
      });
  });
export type SqlOutput = z.infer<typeof sqlOutputSchema>;
