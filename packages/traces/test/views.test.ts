import { describe, expect, it } from "vitest";
import { analyticsViews } from "../src/views/analytics.js";
import { baseViews } from "../src/views/base.js";
import { securityStatements } from "../src/security.js";
import { sessionScopeLookup } from "../src/control.js";

const database = "ac_trace";
const views = Object.fromEntries(
  [...baseViews(database), ...analyticsViews(database)].map((view) => [
    view.name,
    view.sql,
  ]),
);
const scansOf = (sql: string, table: string) =>
  sql.split(`FROM \`${database}\`.\`${table}\` r FINAL`).length - 1;
const sql = (name: string) => {
  const definition = views[name];
  if (definition === undefined) throw new Error(`No view ${name}.`);
  return definition;
};

// @req R-SEC-02
describe("session relations read control once per query and scan each base table once", () => {
  it("looks nothing up per row through a dictionary on the session, message and reuse paths", () => {
    for (const name of [
      "session_live",
      "session_base",
      "session_state",
      "session_details",
      "sessions",
      "messages",
      "message_metadata",
      "reuse_edges",
      "session_reuse",
      "member_impact",
      "metrics_reuse_sessions",
      "metrics_search_sessions",
    ])
      expect(sql(name), name).not.toContain("dictGet(");
  });
  it("scans the sessions table once for rows and once, two columns wide, for parent titles", () => {
    expect(scansOf(sql("session_live"), "sessions")).toBe(1);
    expect(scansOf(sql("session_base"), "sessions")).toBe(1);
    expect(scansOf(sql("session_state"), "sessions")).toBe(1);
    expect(scansOf(sql("session_details"), "sessions")).toBe(2);
    expect(scansOf(sql("session_details"), "session_files")).toBe(1);
    expect(scansOf(sql("sessions"), "sessions")).toBe(2);
    expect(scansOf(sql("sessions"), "session_files")).toBe(1);
    expect(sql("sessions").split("`session_reads` FINAL").length - 1).toBe(1);
    expect(scansOf(sql("messages"), "messages")).toBe(1);
    expect(scansOf(sql("messages"), "sessions")).toBe(1);
    expect(scansOf(sql("reuse_edges"), "sessions")).toBe(0);
    expect(scansOf(sql("member_impact"), "sessions")).toBe(1);
    expect(scansOf(sql("session_reuse"), "sessions")).toBe(2);
    expect(scansOf(sql("metrics_reuse_sessions"), "sessions")).toBe(2);
    expect(sql("member_impact").split("`session_reads` FINAL").length - 1).toBe(
      1,
    );
    expect(
      sql("metrics_reuse_sessions").split("`session_reads` FINAL").length - 1,
    ).toBe(1);
    // Search adoption reads attributed API calls, never the message corpus (ADR 0067).
    expect(scansOf(sql("metrics_search_sessions"), "messages")).toBe(0);
    expect(scansOf(sql("metrics_search_sessions"), "sessions")).toBe(1);
    expect(
      sql("metrics_search_sessions").split("`session_reads` FINAL").length - 1,
    ).toBe(1);
    expect(sql("metrics_search_sessions")).not.toContain("tool_name");
  });
  it("composes public views as one query context instead of layering api_ro views", () => {
    for (const name of [
      "sessions",
      "session_details",
      "session_state",
      "messages",
      "session_reuse",
      "member_impact",
      "metrics_reuse_sessions",
    ])
      expect(sql(name), name).not.toMatch(
        /\bapi_ro\.(session_|reuse_|sessions\b)/,
      );
  });
  it("reads session control at most once per branch and never through a second aggregate", () => {
    const controlReads = (name: string) =>
      sql(name).split("`control_session_scope`").length - 1;
    expect(controlReads("session_live")).toBe(1);
    expect(controlReads("session_base")).toBe(2);
    expect(controlReads("session_details")).toBe(2);
    expect(controlReads("sessions")).toBe(2);
    // Relations that read only projection columns join no control table at all.
    for (const name of [
      "messages",
      "metrics_reuse_sessions",
      "session_reuse",
      "member_impact",
      "metrics_search_sessions",
      "metrics_active_windows",
      "metrics_reads",
    ])
      expect(controlReads(name), name).toBe(0);
    expect(sql("sessions").split("`control_user_scope`").length - 1).toBe(1);
    expect(
      sql("sessions").split("`control_installation_scope`").length - 1,
    ).toBe(1);
  });
  it("keeps one policy scalar text for every guarded table", () => {
    const lookup = sessionScopeLookup(database, "session_id")(
      "published_revision",
      "toInt64(0)",
    );
    const scalar = lookup.slice(
      lookup.indexOf("(SELECT (groupArray(session_id)"),
      lookup.indexOf("),1),tupleElement(") + 1,
    );
    expect(scalar).toMatch(/^\(SELECT \(groupArray\(session_id\).*\)$/);
    const statements = securityStatements({
      url: "http://localhost:8123",
      username: "default",
      password: "x",
      database,
      writerUsername: "w",
      writerPassword: "x",
      accessUsername: "a",
      accessPassword: "x",
      postgresControlUrl: "postgres://u:p@localhost:5432/control",
    }).filter(
      (statement) =>
        statement.includes("trace_scope ON") &&
        statement.includes("control_session_scope") &&
        !statement.includes("ON `ac_trace`.`control_session_scope`"),
    );
    expect(statements.length).toBeGreaterThan(8);
    for (const statement of statements)
      expect(statement.replaceAll(scalar, "")).not.toContain(
        "control_session_scope",
      );
  });
});
