import { describe, expect, it } from "vitest";
import { parse } from "pgsql-ast-parser";
import { guardSql, validateSqlAst } from "../src/repositories/sql-guard.js";

describe("read SQL guard", () => {
  // @req R-SQL-01 @req R-SQL-02
  it.each([
    "SELECT count(*) FROM api_ro.sessions",
    "WITH x AS (SELECT session_id FROM sessions) SELECT * FROM x",
    "WITH RECURSIVE tree(session_id,parent_session_id) AS (SELECT session_id,parent_session_id FROM sessions WHERE parent_session_id IS NULL UNION ALL SELECT s.session_id,s.parent_session_id FROM sessions s JOIN tree t ON s.parent_session_id=t.session_id) SELECT * FROM tree",
    "SELECT s.session_id FROM sessions s WHERE EXISTS (SELECT 1 FROM messages m WHERE m.session_id=s.session_id AND m.content ILIKE '%failure%')",
    "SELECT date_trunc('day', started_at), count(*) FROM sessions GROUP BY 1 ORDER BY 1",
    "SELECT * FROM search_messages('circuit breaker') WHERE session_id IN (SELECT session_id FROM sessions)",
    "SELECT 'bash' = ANY(tools_used), now() - INTERVAL '7 days' FROM sessions",
    "SELECT jsonb_extract_path_text(tool_input, 'command') FROM messages",
    "SELECT * FROM generate_series(1,10000,2)",
    "SELECT 1 UNION SELECT 2",
  ])("accepts a composable read: %s", (sql) => {
    expect(guardSql(sql)).toContain("SELECT");
  });

  // @req R-SQL-01 @req R-SQL-02 @req R-SEC-05
  it.each([
    "SELECT 1; SELECT 2",
    "SET ROLE ac_reader_admin",
    "COPY sessions TO PROGRAM 'id'",
    "DELETE FROM sessions",
    "WITH x AS (DELETE FROM sessions RETURNING *) SELECT * FROM x",
    "SELECT * FROM sessions FOR UPDATE",
    "SELECT * INTO tmp FROM sessions",
    "SELECT * FROM pg_catalog.pg_class",
    "SELECT * FROM information_schema.tables",
    'SELECT * FROM public."AgentSession"',
    "SELECT set_config('agentcommons.organization_id','other',true)",
    "SELECT native_identity('native')",
    "SELECT public.native_identity('native')",
    "SELECT lower(set_config('role','ac_reader_admin',true))",
    "SELECT pg_catalog.count(*) FROM sessions",
    "SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_class)",
    "SELECT ARRAY(SELECT oid FROM pg_catalog.pg_class)",
    "SELECT CASE WHEN true THEN (SELECT current_setting('role')) ELSE '' END",
    "SELECT count(*) FILTER (WHERE set_config('role','x',true) IS NOT NULL) FROM sessions",
    "SELECT 'public.AgentSession'::regclass",
    "SELECT 'pg_read_file'::regproc",
    "SELECT * FROM generate_series(1,10001)",
    "SELECT * FROM generate_series(1,(SELECT count(*) FROM sessions))",
    "SELECT similar_sessions('x')",
    "SELECT 1 OPERATOR(pg_catalog.+) 2",
    "SELECT 1 OPERATOR(public.+) 2",
    "SELECT 1 === 2",
    'SELECT title COLLATE "C" FROM sessions',
    "WITH safe AS (WITH leaked AS (SELECT 1) SELECT * FROM leaked) SELECT * FROM leaked",
  ])("rejects the injection or unsupported relation: %s", (sql) => {
    expect(() => guardSql(sql)).toThrow();
  });

  it("fails closed on parser extensions at any depth", () => {
    const ast = parse("SELECT lower(title) FROM sessions")[0];
    if (!ast || ast.type !== "select" || !ast.columns?.[0])
      throw new Error("missing parsed column");
    Object.assign(ast.columns[0].expr, {
      newParserOption: { type: "select", from: [] },
    });
    expect(() => {
      validateSqlAst(ast);
    }).toThrow("Unsupported SQL syntax");
  });
  it("preserves numeric literals and string content while stripping terminal comments and semicolons", () => {
    expect(
      guardSql(
        "/* lead */ SELECT 1.234567890123456789,9007199254740993,'; DROP TABLE x'; -- tail",
      ),
    ).toBe("SELECT 1.234567890123456789,9007199254740993,'; DROP TABLE x'");
    expect(guardSql("SELECT 1 -- comment\n")).toBe("SELECT 1");
  });
  it("rejects unknown operator values even when the AST has otherwise known fields", () => {
    const ast = parse("SELECT 1 + 2")[0];
    if (!ast || ast.type !== "select" || !ast.columns?.[0])
      throw new Error("missing expression");
    Object.assign(ast.columns[0].expr, { op: "custom_operator" });
    expect(() => {
      validateSqlAst(ast);
    }).toThrow("operator");
  });
});
