import { Prisma } from "@agentcommons/db";
import { ClickHouseError } from "@agentcommons/traces";
import { z } from "zod";
import { ServiceError } from "../services/context.js";

/** Seconds a client waits before retrying a trace read the databases could not complete. */
const READ_RETRY_AFTER_SECONDS = 5;
/** ClickHouse `max_execution_time` (§7.5) and the read budget around it. */
const timeLimitCodes = new Set(["159", "160"]);
/** Server-side ClickHouse conditions a retry can outlive: saturated, cancelled, transport. */
const transientCodes = new Set(["202", "209", "210", "394", "439"]);
/** Prisma client codes for a control database that did not answer in time. */
const busyPrismaCodes = new Set(["P1008", "P1017", "P2024", "P2028"]);
/** PostgreSQL states behind a raw statement (`P2010`) that a retry can outlive: lock and statement timeouts, serialization, deadlock, saturation. */
const busySqlStates = new Set([
  "55P03",
  "57014",
  "40001",
  "40P01",
  "53300",
  "57P03",
]);
/** The same conditions when Prisma surfaces them as an unknown request error. */
const busyMessage =
  /lock timeout|statement timeout|deadlock detected|too many clients|canceling statement|connection pool/i;
const rawFailureSchema = z.object({ code: z.string() });

function retryable(
  code: string,
  message: string,
  cause: unknown,
): ServiceError {
  const failure = new ServiceError(503, code, message, {
    retry_after: READ_RETRY_AFTER_SECONDS,
  });
  failure.cause = cause;
  return failure;
}
/** The 503 for a trace database that could not run the read (unreachable, cancelled, saturated). */
export function traceQueryUnavailable(cause: unknown): ServiceError {
  return retryable(
    "TRACE_QUERY_UNAVAILABLE",
    "The trace database did not complete the query. Try again.",
    cause,
  );
}
/** Whether a client-side abort ended the read: the read budget (§7.5) or the ClickHouse client's own timeout. */
function abortedRead(error: Error): boolean {
  return (
    error.name === "TimeoutError" ||
    error.name === "AbortError" ||
    /aborted a request|^Timeout error/i.test(error.message)
  );
}
/** Whether the control database (PostgreSQL) refused or timed out rather than failed the statement. */
function controlBusy(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError)
    return (
      busyPrismaCodes.has(error.code) ||
      (error.code === "P2010" &&
        busySqlStates.has(
          rawFailureSchema.safeParse(error.meta).data?.code ?? "",
        ))
    );
  if (error instanceof Prisma.PrismaClientInitializationError) return true;
  return (
    error instanceof Prisma.PrismaClientUnknownRequestError &&
    busyMessage.test(error.message)
  );
}
/**
 * The stable, documented failure of a trace read (§7.4, §7.5) for every read path (search,
 * get, lists, tree, reuse, similar, events, exports, sql, dashboard tiles), or null when the
 * error is not a known limit or availability condition and stays an unexpected
 * `OPERATION_FAILED`. Every classified failure is a 503 with `retry_after`: the server's
 * query exceeding its own limits or a control database that could not answer is a server
 * condition, and the message tells an agent what to do next (retry; narrow; for text search,
 * `sql` over `search_messages`). Messages never echo SQL or values; `cause` is kept for the
 * request log.
 */
export function traceReadFailure(error: unknown): ServiceError | null {
  if (error instanceof ServiceError) return error;
  if (
    (error instanceof ClickHouseError && timeLimitCodes.has(error.code)) ||
    (error instanceof Error && abortedRead(error))
  )
    return retryable(
      "READ_TIME_LIMIT",
      "The read exceeded its 5 second time limit. Retry in a moment; if it keeps failing, narrow the time range or filters, or for text search run sql over search_messages(q='words') with a LIMIT.",
      error,
    );
  if (error instanceof ClickHouseError) {
    // A server-authored read that outgrows the reader limits is a server condition (503);
    // `queryFailure` answers a caller's own SQL with 400 QUERY_* before reaching here.
    if (error.code === "241")
      return retryable(
        "READ_MEMORY_LIMIT",
        "The read exceeded the server's 256 MiB memory limit. Narrow the range, time window or filters and try again.",
        error,
      );
    if (error.code === "396")
      return retryable(
        "READ_RESULT_LIMIT",
        "The read exceeded the server's result size limit. Narrow the range, time window or filters and try again.",
        error,
      );
    if (transientCodes.has(error.code)) return traceQueryUnavailable(error);
    return null;
  }
  if (controlBusy(error))
    return retryable(
      "READ_BUSY",
      "The database is busy. Retry in a moment.",
      error,
    );
  return null;
}
