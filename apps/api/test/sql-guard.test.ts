import { describe, expect, it } from "vitest";
import { guardSql, queryFailure } from "../src/repositories/sql-guard.js";
import { traceReadFailure } from "../src/repositories/read-failure.js";
import { ClickHouseError } from "@agentcommons/traces";
import { Prisma } from "@agentcommons/db";
import { embeddingsUnavailable } from "../src/embeddings/settings.js";
import { ServiceError } from "../src/services/context.js";
import { z } from "zod";

describe("native read SQL guard", () => {
  // @req R-SQL-01 @req R-SQL-02
  it.each([
    "SELECT count() FROM api_ro.sessions",
    "SELECT sum(agentcommons_search_calls) FROM metrics_search_sessions WHERE repeat_agentcommons_search_calls > 0",
    "WITH x AS (SELECT session_id FROM sessions) SELECT * FROM x",
    "SELECT s.session_id FROM sessions s WHERE EXISTS (SELECT 1 FROM messages m WHERE m.session_id=s.session_id AND m.content ILIKE '%failure%')",
    "SELECT dateTrunc('day', started_at), count() FROM sessions GROUP BY 1 ORDER BY 1",
    "SELECT * FROM search_messages(q='circuit breaker') WHERE session_id IN (SELECT session_id FROM sessions)",
    "SELECT has(tools_used,'Bash'), now() - INTERVAL 7 DAY FROM sessions",
    "SELECT JSONExtractString(tool_input, 'command') FROM messages",
    "SELECT 1 UNION ALL SELECT 2",
  ])("accepts a composable native read: %s", (sql) => {
    expect(guardSql(sql, embeddingsUnavailable)).toContain("SELECT");
  });

  // @req R-SQL-01 @req R-SQL-02 @req R-SEC-05
  it.each([
    "SELECT 1; SELECT 2",
    "SET ROLE ac_reader_admin",
    "DELETE FROM sessions",
    "SELECT * FROM sessions FOR UPDATE",
    "SELECT * FROM system.tables",
    "SELECT * FROM information_schema.tables",
    "SELECT * FROM ac_trace.messages",
    "SELECT getSetting('custom_organization')",
    "SELECT * FROM remote('localhost','system','users')",
    "SELECT * FROM file('/etc/passwd')",
    "SELECT * FROM url('https://example.com','JSONEachRow')",
    "SELECT dictGet('session_scope','visible',1)",
    "SELECT * FROM sessions SETTINGS max_execution_time=100",
    "SELECT 1 INTO OUTFILE '/tmp/leak'",
    "SELECT 1 FORMAT CSV",
    "SELECT {user:String}",
    "SELECT * FROM similar_sessions(source='00000000-0000-0000-0000-000000000000',max_rows=5)",
    "SELECT * FROM search_messages(secret='q')",
    "SELECT * FROM search_messages(q='x',q='y')",
    "SELECT * FROM search_messages(q=(SELECT password FROM system.users))",
    "SELECT * FROM search_messages('legacy positional query')",
    "SELECT search_messages(q='x')",
    "SELECT * FROM message_chunks",
  ])("rejects the injection or unavailable capability: %s", (sql) => {
    expect(() => guardSql(sql, embeddingsUnavailable)).toThrow();
  });

  it("preserves literal precision and reports parse positions through the service error boundary", () => {
    const sql = guardSql(
      "SELECT toDecimal128('1.234567890123456789',18),9007199254740993,'; DROP TABLE x'; -- tail",
      embeddingsUnavailable,
    );
    expect(sql).toContain("1.234567890123456789");
    expect(sql).toContain("9007199254740993");
    expect(sql).toContain("'; DROP TABLE x'");
    try {
      guardSql("SELECT\n ???", embeddingsUnavailable);
      throw new Error("Expected syntax rejection");
    } catch (error) {
      expect(error).toMatchObject({ code: "SQL_REJECTED" });
      if (!(error instanceof ServiceError)) throw error;
      expect(
        z.object({ position: z.number() }).parse(error.detail).position,
      ).toBeGreaterThan(7);
    }
  });
});

describe("native query failure codes", () => {
  const native = (code: string, type: string) =>
    new ClickHouseError({
      code,
      type,
      message: `${type}: private literal 'secret-value' (query: SELECT 'secret-value')`,
    });
  // @req R-SQL-07 @req R-SQL-04 @req R-GET-07
  it.each([
    ["159", "TIMEOUT_EXCEEDED", 503, "READ_TIME_LIMIT", "search_messages"],
    ["160", "TOO_SLOW", 503, "READ_TIME_LIMIT", "5 second"],
    ["241", "MEMORY_LIMIT_EXCEEDED", 400, "QUERY_MEMORY_LIMIT", "memory limit"],
    ["396", "TOO_MANY_ROWS_OR_BYTES", 400, "QUERY_RESULT_LIMIT", "size limit"],
    ["47", "UNKNOWN_IDENTIFIER", 400, "QUERY_INVALID", "schema_columns"],
    ["53", "TYPE_MISMATCH", 400, "QUERY_INVALID", "incompatible value types"],
    ["62", "SYNTAX_ERROR", 400, "QUERY_INVALID", "syntax is invalid"],
    [
      "202",
      "TOO_MANY_SIMULTANEOUS_QUERIES",
      503,
      "TRACE_QUERY_UNAVAILABLE",
      "Try again",
    ],
    ["394", "QUERY_WAS_CANCELLED", 503, "TRACE_QUERY_UNAVAILABLE", "Try again"],
    ["49", "LOGICAL_ERROR", 500, "QUERY_FAILED", "could not be run"],
  ])(
    "maps ClickHouse %s %s to %i %s",
    (code, type, statusCode, expected, hint) => {
      const failure = queryFailure(native(code, type));
      expect(failure).toBeInstanceOf(ServiceError);
      expect(failure).toMatchObject({ statusCode, code: expected });
      expect(failure.message).toContain(hint);
      // Native error numbers and the caller's SQL or values never reach the client.
      expect(failure.message).not.toContain("secret-value");
      expect(failure.code).not.toMatch(/^\d+$/);
      expect(
        z.object({ position: z.null() }).loose().parse(failure.detail).position,
      ).toBeNull();
      if (statusCode === 503)
        expect(failure.detail).toMatchObject({ retry_after: 5 });
    },
  );
  // @req R-SQL-07
  it("keeps the cause for the request log and marks unavailable results retryable", () => {
    const unreachable = new Error("connect ECONNREFUSED 127.0.0.1:1");
    const failure = queryFailure(unreachable);
    expect(failure).toMatchObject({
      statusCode: 503,
      code: "TRACE_QUERY_UNAVAILABLE",
      detail: { position: null, retry_after: 5 },
    });
    expect(failure.cause).toBe(unreachable);
    const unclassified = native("49", "LOGICAL_ERROR");
    expect(queryFailure(unclassified).cause).toBe(unclassified);
    const own = new ServiceError(400, "SQL_REJECTED", "rejected", {
      position: 3,
    });
    expect(queryFailure(own)).toBe(own);
  });
});

describe("trace read failure classification shared by every read path", () => {
  const known = (code: string, meta?: Record<string, unknown>) =>
    new Prisma.PrismaClientKnownRequestError("database failure", {
      code,
      clientVersion: "test",
      ...(meta ? { meta } : {}),
    });
  // @req R-GET-07 @req R-SQL-07
  it.each([
    [
      "ClickHouse 159 TIMEOUT_EXCEEDED",
      new ClickHouseError({
        code: "159",
        type: "TIMEOUT_EXCEEDED",
        message: "Timeout exceeded",
      }),
      503,
      "READ_TIME_LIMIT",
    ],
    [
      "read budget abort",
      new DOMException(
        "The operation was aborted due to timeout",
        "TimeoutError",
      ),
      503,
      "READ_TIME_LIMIT",
    ],
    [
      "client abort",
      new Error("The user aborted a request."),
      503,
      "READ_TIME_LIMIT",
    ],
    [
      "ClickHouse 241 MEMORY_LIMIT_EXCEEDED",
      new ClickHouseError({
        code: "241",
        type: "MEMORY_LIMIT_EXCEEDED",
        message: "Memory limit",
      }),
      503,
      "READ_MEMORY_LIMIT",
    ],
    [
      "ClickHouse 396 TOO_MANY_ROWS_OR_BYTES",
      new ClickHouseError({
        code: "396",
        type: "TOO_MANY_ROWS_OR_BYTES",
        message: "Limit",
      }),
      503,
      "READ_RESULT_LIMIT",
    ],
    [
      "ClickHouse 202 TOO_MANY_SIMULTANEOUS_QUERIES",
      new ClickHouseError({
        code: "202",
        type: "TOO_MANY_SIMULTANEOUS_QUERIES",
        message: "Too many",
      }),
      503,
      "TRACE_QUERY_UNAVAILABLE",
    ],
    [
      "PostgreSQL lock timeout (P2010 55P03)",
      known("P2010", {
        code: "55P03",
        message: "canceling statement due to lock timeout",
      }),
      503,
      "READ_BUSY",
    ],
    [
      "PostgreSQL statement timeout (P2010 57014)",
      known("P2010", {
        code: "57014",
        message: "canceling statement due to statement timeout",
      }),
      503,
      "READ_BUSY",
    ],
    ["Prisma pool timeout (P2024)", known("P2024"), 503, "READ_BUSY"],
    ["Prisma expired transaction (P2028)", known("P2028"), 503, "READ_BUSY"],
    [
      "PostgreSQL statement timeout as unknown error",
      new Prisma.PrismaClientUnknownRequestError(
        "canceling statement due to statement timeout",
        { clientVersion: "test" },
      ),
      503,
      "READ_BUSY",
    ],
  ])("maps %s to %i %s", (_name, error, statusCode, code) => {
    const failure = traceReadFailure(error);
    expect(failure).toMatchObject({ statusCode, code });
    expect(failure?.cause).toBe(error);
    // Every server-side read condition is retryable and says what to do next.
    expect(failure?.detail).toMatchObject({ retry_after: 5 });
    expect(failure?.message).toMatch(/retry|narrow|try again/i);
  });
  // @req R-GET-07
  it("leaves unexpected failures unclassified so they stay OPERATION_FAILED", () => {
    expect(traceReadFailure(new Error("unexpected"))).toBeNull();
    expect(traceReadFailure(known("P2002"))).toBeNull();
    expect(traceReadFailure(known("P2010", { code: "42P01" }))).toBeNull();
    expect(
      traceReadFailure(
        new ClickHouseError({
          code: "47",
          type: "UNKNOWN_IDENTIFIER",
          message: "x",
        }),
      ),
    ).toBeNull();
    const own = new ServiceError(404, "NOT_FOUND", "gone");
    expect(traceReadFailure(own)).toBe(own);
  });
});
