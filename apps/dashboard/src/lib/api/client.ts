import createClient from "openapi-fetch";
import qs from "qs";
import { errorSchema } from "@agentcommons/core/schemas/common";
import { copy } from "../../copy";
import type { paths } from "./generated";

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
/**
 * Object-valued query members travel as JSON, which the server parses for any object
 * schema; scalars and lists use bracket encoding. The client knows no route's shape.
 */
export const api = createClient<paths, "application/json">({
  credentials: "include",
  querySerializer: (query) =>
    qs.stringify(
      Object.fromEntries(
        Object.entries(query).map(([key, value]) => [
          key,
          isPlainObject(value) ? JSON.stringify(value) : value,
        ]),
      ),
      { arrayFormat: "brackets", skipNulls: true },
    ),
});
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    /** Character offset into a submitted SQL query, when the server reports one. */
    public readonly position: number | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export function unwrap<T>(result: {
  data?: T;
  error?: unknown;
  response: Response;
}): T {
  if (!result.response.ok || result.data === undefined) {
    const parsed = errorSchema.safeParse(result.error);
    throw new ApiError(
      result.response.status,
      parsed.success ? parsed.data.code : "request_failed",
      parsed.success ? parsed.data.message : copy.app.common.requestFailed,
      parsed.success ? (parsed.data.position ?? null) : null,
    );
  }
  return result.data;
}

type Defined<T> = T extends readonly unknown[]
  ? { [K in keyof T]: Defined<T[K]> }
  : T extends object
    ? { [K in keyof T]: Defined<Exclude<T[K], undefined>> }
    : T;

/** Match JSON's omission of optional undefined properties, including nested filters. */
export function defined<T extends object>(value: T): Defined<T> {
  return JSON.parse(JSON.stringify(value)) as Defined<T>;
}
