import { createClient, unwrap as unwrapResponse } from "@agentcommons/sdk";
import { copy } from "../../copy";

export { ApiError } from "@agentcommons/sdk";

export const api = createClient({ credentials: "include" });

export function unwrap<T>(result: {
  data?: T;
  error?: unknown;
  response: Response;
}): T {
  return unwrapResponse(result, copy.app.common.requestFailed);
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
