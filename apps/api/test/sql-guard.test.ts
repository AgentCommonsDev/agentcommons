import { describe, expect, it } from "vitest";
import { guardSql } from "../src/repositories/sql-guard.js";
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
    expect(guardSql(sql)).toContain("SELECT");
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
    expect(() => guardSql(sql)).toThrow();
  });

  it("preserves literal precision and reports parse positions through the service error boundary", () => {
    const sql = guardSql(
      "SELECT toDecimal128('1.234567890123456789',18),9007199254740993,'; DROP TABLE x'; -- tail",
    );
    expect(sql).toContain("1.234567890123456789");
    expect(sql).toContain("9007199254740993");
    expect(sql).toContain("'; DROP TABLE x'");
    try {
      guardSql("SELECT\n ???");
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
