import createClient from "openapi-fetch";
import qs from "qs";
import { errorSchema } from "@agentcommons/core/schemas/common";
import { copy } from "../../copy";
import type { paths } from "./generated";
export const api = createClient<paths, "application/json">({
  credentials: "include",
  querySerializer: (query) =>
    qs.stringify(
      {
        ...query,
        ...(typeof query.filters !== "object" ||
        query.filters === null ||
        !("where" in query.filters)
          ? {}
          : { filters: JSON.stringify(query.filters) }),
      },
      { arrayFormat: "brackets", skipNulls: true },
    ),
});
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
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
