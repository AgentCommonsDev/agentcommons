import createOpenApiClient, {
  mergeHeaders,
  type ClientOptions,
} from "openapi-fetch";
import qs from "qs";
import { z } from "zod";
import type { paths } from "./generated.js";

export type { paths, components, operations } from "./generated.js";
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type AgentCommonsOptions = Omit<ClientOptions, "querySerializer"> & {
  /** Organization API key. Omit for public endpoints or cookie authentication. */
  apiKey?: string | undefined;
};

/** Objects are JSON query values; arrays use the API's bracket encoding. */
export function serializeQuery(query: Record<string, unknown>): string {
  return qs.stringify(
    Object.fromEntries(
      Object.entries(query).map(([key, value]) => [
        key,
        typeof value === "object" && value !== null && !Array.isArray(value)
          ? JSON.stringify(value)
          : value,
      ]),
    ),
    { arrayFormat: "brackets", skipNulls: true },
  );
}

/** Create an isolated client. Requests are never retried automatically. */
export function createClient({ apiKey, ...options }: AgentCommonsOptions = {}) {
  const headers = mergeHeaders(options.headers);
  if (apiKey !== undefined) headers.set("Authorization", `Bearer ${apiKey}`);
  return createOpenApiClient<paths, "application/json">({
    ...options,
    headers,
    querySerializer: serializeQuery,
  });
}

const errorEnvelope = z.object({
  code: z.string(),
  message: z.string(),
  position: z.number().int().nonnegative().nullable().optional(),
  detail: z.json().optional(),
});

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly position: number | null = null,
    public readonly detail?: JsonValue,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Return a successful response body or throw the API's structured error. */
export function unwrap<T>(
  result: { data?: T; error?: unknown; response: Response },
  fallbackMessage = "Request failed.",
): T {
  if (!result.response.ok || result.data === undefined) {
    const parsed = errorEnvelope.safeParse(result.error);
    throw new ApiError(
      result.response.status,
      parsed.success ? parsed.data.code : "request_failed",
      parsed.success ? parsed.data.message : fallbackMessage,
      parsed.success ? (parsed.data.position ?? null) : null,
      parsed.success ? parsed.data.detail : undefined,
    );
  }
  return result.data;
}
