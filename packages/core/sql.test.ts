import { expect, it } from "vitest";
import {
  embeddingsRequiredMessage,
  guardTraceSql,
  parseTraceSql,
  TraceSqlError,
} from "./sql.js";

// @req R-SQL-01
it("validates native ClickHouse SELECT, CTE, JSON, aggregate and window syntax and serializes its vetted AST", () => {
  for (const sql of [
    "SELECT count() AS n FROM sessions",
    "WITH work AS (SELECT session_id FROM api_ro.sessions) SELECT * FROM work",
    "SELECT toStartOfDay(started_at) AS day, count() AS n FROM sessions GROUP BY day ORDER BY day",
    "SELECT JSONExtractString(tool_input, 'command'), countIf(role='ASSISTANT') FROM messages GROUP BY 1",
    "SELECT CAST(1 AS UInt64)",
    "SELECT row_number() OVER (ORDER BY started_at) AS n FROM sessions",
    "SELECT '-- SETTINGS' AS text FROM sessions; -- harmless comment",
  ])
    expect(parseTraceSql(guardTraceSql(sql))).toHaveLength(1);
});

// @req R-SQL-01 @req R-SQL-02
it("rejects settings, caller parameters, network and file access, hidden tables and nested escapes", () => {
  for (const sql of [
    "DELETE FROM sessions",
    "SELECT 1; SELECT 2",
    "SHOW TABLES",
    "SELECT * FROM sessions SETTINGS max_execution_time=100",
    "SELECT 1 FORMAT CSV",
    "SELECT 1 INTO OUTFILE '/tmp/escape'",
    "SELECT {organization:String}",
    "SELECT getSetting('custom_organization')",
    "SELECT * FROM url('https://example.com', JSONEachRow)",
    "SELECT * FROM file('/etc/passwd')",
    "SELECT * FROM remote('server', 'db', 'table')",
    "SELECT * FROM system.tables",
    "SELECT (SELECT count() FROM public.user)",
    "WITH x AS (SELECT * FROM system.tables) SELECT * FROM x",
    "SELECT dictGet('private', 'secret', 1)",
    "SELECT sleep(60)",
    "SELECT * FROM sessions WHERE session_id IN (SELECT session_id FROM internal.raw_record)",
  ])
    expect(() => guardTraceSql(sql), sql).toThrow(TraceSqlError);
});

// @req R-SQL-01
it("reports original syntax locations and gates vector functions without changing the parser", () => {
  try {
    guardTraceSql("SELECT\n ???");
    throw new Error("Expected syntax rejection");
  } catch (error) {
    expect(error).toBeInstanceOf(TraceSqlError);
    if (error instanceof TraceSqlError)
      expect(error.position).toBeGreaterThan(7);
  }
  const sql = "SELECT cosineDistance([1,2],[2,3])";
  expect(() => guardTraceSql(sql)).toThrow(TraceSqlError);
  expect(guardTraceSql(sql, true)).toContain("cosineDistance");
  // Without embeddings every vector reference names itself and the missing capability,
  // so an assistant learns why instead of hunting for a syntax error.
  for (const [vector, capability] of [
    [
      "SELECT * FROM similar_sessions(source='00000000-0000-0000-0000-000000000000',max_rows=5)",
      "similar_sessions",
    ],
    ["SELECT count() FROM message_chunks", "message_chunks"],
    ["SELECT count() FROM api_ro.session_embeddings", "session_embeddings"],
    [sql, "cosineDistance"],
    ["SELECT L2Distance([1],[2])", "L2Distance"],
  ] as const) {
    const error: unknown = (() => {
      try {
        guardTraceSql(vector);
        return null;
      } catch (caught) {
        return caught;
      }
    })();
    expect(error).toBeInstanceOf(TraceSqlError);
    if (error instanceof TraceSqlError) {
      expect(error.capability).toBe(capability);
      expect(error.message).toBe(embeddingsRequiredMessage(capability));
      expect(error.position).toBeGreaterThan(0);
    }
  }
  // A CTE may reuse a vector view's name; that is the caller's own binding, not the view.
  expect(
    guardTraceSql(
      "WITH message_chunks AS (SELECT 1 AS x) SELECT x FROM message_chunks",
    ),
  ).toContain("message_chunks");
  expect(() =>
    guardTraceSql("SELECT * FROM similar_sessions(q='x')", true),
  ).toThrow("Use search_messages");
  expect(() => guardTraceSql(`SELECT '${"x".repeat(21000)}'`)).toThrow("20 KB");
});
