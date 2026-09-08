import createClient from "openapi-fetch";
import qs from "qs";
import { errorSchema } from "@agentcommons/core/schemas/common";
import { copy } from "../../copy";
import type { paths } from "./generated";
export const api = createClient<paths, "application/json">({
  credentials: "include",
  querySerializer: (query) =>
    qs.stringify(query, { arrayFormat: "brackets", skipNulls: true }),
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
      parsed.success
        ? parsed.data.message
        : copy.workspace.common.requestFailed,
    );
  }
  return result.data;
}

/** Omit optional undefined fields before passing Zod output to the wire contract. */
export function defined<T extends object>(
  value: T,
): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as { [K in keyof T]: Exclude<T[K], undefined> };
}
