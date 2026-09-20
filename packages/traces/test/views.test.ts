import { describe, expect, it } from "vitest";
import { analyticsViews } from "../src/views/analytics.js";
import { baseViews } from "../src/views/base.js";
import { searchViews } from "../src/views/search.js";
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

// @req R-SEC-02 @req R-DASH-42
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
    // The three read aggregates of `sessions` come from that one pass, credited to the
    // reading session and, for edges, to the read session (R-DASH-42).
    expect(
      sql("sessions").split(
        "ARRAY JOIN [('in',r.target_session_id),('out',r.session_id)] AS credit",
      ).length - 1,
    ).toBe(1);
    expect(sql("sessions")).toMatch(
      /coalesce\(r\.reuse_count,toUInt64\(0\)\) AS reuse_count,coalesce\(r\.agentcommons_search_calls,toUInt64\(0\)\) AS agentcommons_search_calls,coalesce\(r\.reuses_made,toUInt64\(0\)\) AS reuses_made FROM/,
    );
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

// @req R-DASH-13
describe("audit-derived metrics read JSON types by the names JSONType returns", () => {
  // JSONType yields Enum8('Null','String','Array','Bool','Double','Int64','UInt64','Object').
  // A name outside that set, such as 'Float64', never matches, silently drops the value and
  // makes ClickHouse raise (and count) UNKNOWN_ELEMENT_OF_ENUM every time the view is
  // analysed: 30 times on the hosted instance between 2026-09-09 and 2026-09-12, once per
  // migration.
  it("compares JSONType only against its enum elements", () => {
    const elements = new Set([
      "Null",
      "String",
      "Array",
      "Bool",
      "Double",
      "Int64",
      "UInt64",
      "Object",
    ]);
    const comparisons = Object.entries(views).flatMap(([name, definition]) =>
      [
        ...definition.matchAll(
          /JSONType\((?:[^()]|\([^()]*\))*\)\s*(?:=\s*'([A-Za-z0-9]+)'|IN\s*\(([^)]*)\))/g,
        ),
      ].map((match) => ({
        view: name,
        names:
          match[1] !== undefined
            ? [match[1]]
            : ((match[2] ?? "")
                .match(/'([^']*)'/g)
                ?.map((quoted) => quoted.slice(1, -1)) ?? []),
      })),
    );
    expect(comparisons.length).toBeGreaterThan(1);
    for (const comparison of comparisons)
      for (const typeName of comparison.names)
        expect(elements.has(typeName), `${comparison.view}: ${typeName}`).toBe(
          true,
        );
    expect(sql("metrics_reads")).toContain(
      "JSONType(a.detail,'result','hits') IN ('Int64','UInt64','Double')",
    );
  });
});

// @req R-DASH-47
describe("adoption and reuse metrics can be scoped to root sessions", () => {
  it("expose the projection's parent_session_id and the weekly trend counts roots only", () => {
    for (const name of ["metrics_search_sessions", "metrics_reuse_sessions"])
      expect(sql(name), name).toContain(
        "s.parent_session_id AS parent_session_id",
      );
    expect(sql("metrics_reuse_weekly")).toContain(
      "FROM api_ro.metrics_reuse_sessions WHERE parent_session_id IS NULL GROUP BY week",
    );
  });
  it("rolls each session's reads up to its root before the roots-only filter", () => {
    for (const name of ["metrics_search_sessions", "metrics_reuse_sessions"]) {
      // The root map credits every session to its topmost visible ancestor, matching the
      // way session_details and sessionLinks compute the root; the projection is materialized
      // once and walked up with a bounded self-join ladder, not re-scanned per level.
      expect(sql(name), name).toContain("WITH proj AS MATERIALIZED");
      expect(sql(name), name).toContain(
        "rootmap AS (SELECT p0.session_id AS session_id,coalesce(",
      );
      expect(sql(name), name).toContain(
        "LEFT JOIN proj p1 ON p1.session_id=p0.parent_session_id",
      );
      // Reads are aggregated by the reading session's root, not the reading session, so a
      // root's flags and call count include its subagents' reads.
      expect(sql(name), name).toContain(
        "JOIN rootmap ro ON ro.session_id=r.session_id",
      );
      expect(sql(name), name).toContain("GROUP BY ro.root_session_id");
      expect(sql(name), name).not.toContain("GROUP BY r.session_id");
    }
    // The rollup adds no api_ro layering and no second control read (one query context).
    expect(sql("metrics_reuse_sessions")).not.toMatch(/\bapi_ro\./);
    expect(sql("metrics_search_sessions")).not.toMatch(/\bapi_ro\./);
  });
});

// @req R-SRCH-06 @req R-SRCH-18 @req R-SRCH-21
describe("search reads the published-only corpus with one FINAL scan per matcher pass", () => {
  const search = Object.fromEntries(
    searchViews(database).map((view) => [view.name, view.sql]),
  );
  const search_sql = (name: string) => {
    const definition = search[name];
    if (definition === undefined) throw new Error(`No search view ${name}.`);
    return definition;
  };
  const corpusScans = (sql: string) =>
    sql.split(`\`${database}\`.\`messages_current\` FINAL`).length - 1;
  it("scans messages_current, never messages, and drops the cross-revision latest GROUP-BY", () => {
    for (const name of ["search_messages", "search_messages_session"]) {
      const sql = search_sql(name);
      // Reads the corpus, not the primary `messages` table or its base view.
      expect(sql, name).not.toMatch(/FROM `ac_trace`\.messages FINAL/);
      expect(sql, name).not.toMatch(/\bapi_ro\.messages\b/);
      // No `latest` GROUP-BY (max(revision) per message_id): FINAL resolves the latest
      // published revision intrinsically on the corpus, so it is not recomputed.
      expect(sql, name).not.toContain("max(revision)");
      // The corpus is the current generation; the search path never filters by generation.
      expect(sql, name).not.toContain("generation");
      // Tombstones and pending rows never surface: FINAL plus the deleted filter.
      expect(sql, name).toContain("NOT deleted");
    }
    // Strict match: one corpus scan. Relaxation: two (the message pass and the session
    // set that must together cover every query token) — never four as `messages` needed.
    expect(corpusScans(search_sql("search_messages"))).toBe(1);
    expect(corpusScans(search_sql("search_messages_session"))).toBe(2);
  });
});
