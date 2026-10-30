import { describe, expect, it } from "vitest";
import {
  formatSchemaContext,
  schemaContextExamples,
} from "./schema-context.js";
import {
  guardTraceSql,
  traceEmbeddingViews,
  traceSqlFunctions,
  traceVectorFunctions,
  traceViewCatalog,
  traceViews,
} from "../sql.js";
import { dashboardParameterTypes } from "../dashboards/variables.js";
import { standardDashboardVariables } from "../dashboards/templates.js";

const schema = {
  columns: [
    {
      view_name: "messages",
      column_name: "seq",
      data_type: "UInt32",
      ordinal_position: 2,
      description: "Position of the block inside its session",
    },
    {
      view_name: "messages",
      column_name: "session_id",
      data_type: "UUID",
      ordinal_position: 1,
      description: null,
    },
    {
      view_name: "custom_view",
      column_name: "value",
      data_type: "String",
      ordinal_position: 1,
      description: "Added by a\nmigration",
    },
    {
      view_name: "sessions",
      column_name: "session_id",
      data_type: "UUID",
      ordinal_position: 1,
      description: "Session id | primary key",
    },
    {
      view_name: "sessions",
      column_name: "started_at",
      data_type: "DateTime64(6, 'UTC')",
      ordinal_position: 2,
      description: "When the first record arrived",
    },
  ],
  functions: [
    {
      function_name: "search_messages",
      arguments: "q=String",
      result_type: "session_id UUID, seq UInt32, rank Float64",
      description: "Visible lexical matches.",
    },
  ],
};

/** The full current catalog with placeholder types, for size and coverage checks. */
const fullSchema = {
  columns: [...traceViews, ...traceEmbeddingViews].flatMap((view) =>
    Object.keys(traceViewCatalog[view].columns).map((column, index) => ({
      view_name: view,
      column_name: column,
      data_type: "Nullable(String)",
      ordinal_position: index + 1,
      description: traceViewCatalog[view].columns[column] ?? null,
    })),
  ),
  functions: schema.functions,
};

const sectionHeadings = (text: string) =>
  text
    .split("\n")
    .filter((line) => line.startsWith("## "))
    .map((line) => line.slice(3));

describe("assistant schema reference", () => {
  // @req R-DASH-22
  it("frames the text for an assistant, states the rules, and orders the sections", () => {
    const text = formatSchemaContext(schema);
    expect(text.startsWith("# AgentCommons schema reference\n")).toBe(true);
    expect(text).toContain(
      "You are helping someone write SQL for AgentCommons, a searchable index of the coding-agent sessions",
    );
    expect(text).toContain("authoritative schema reference");
    expect(text).toContain("read-only ClickHouse views");
    expect(text).toContain("Use it to construct queries for them");
    expect(sectionHeadings(text)).toEqual([
      "What the data is",
      "Rules",
      "Dashboard parameters",
      "Views",
      "Table functions",
      "Relationships",
      "Useful patterns",
      "Example queries",
      "Allowed functions",
    ]);
    expect(text).toContain("exactly one SELECT statement per run");
    expect(text).toContain("Query only the `api_ro` views listed under Views");
    expect(text).toContain("listed under Allowed functions");
    expect(text).toContain("500 rows");
    expect(text).toContain("5 s");
    expect(text).toContain("256 KB");
    expect(text).toContain("Never filter on `organization_id`");
    expect(text).toContain(
      "`{name:Type}` query parameters are allowed only inside dashboard tiles",
    );
    expect(text).toContain("`{time_range_from:DateTime}`");
    expect(text).toContain("`{time_range_to:DateTime}`");
    expect(text).toContain("`{repo:Array(String)}`");
    expect(text).toContain(
      "(empty({repo:Array(String)}) OR repo_name IN {repo:Array(String)})",
    );
  });

  // @req R-DASH-22
  it("lists every view with its purpose and every column with type and meaning, in canonical order", () => {
    const text = formatSchemaContext(schema);
    expect(text.indexOf("### sessions")).toBeLessThan(
      text.indexOf("### messages"),
    );
    expect(text.indexOf("### messages")).toBeLessThan(
      text.indexOf("### custom_view"),
    );
    expect(text).toContain(
      `### sessions\n\n${traceViewCatalog.sessions.purpose}\n\n- session_id UUID: Session id | primary key\n- started_at DateTime64(6, 'UTC'): When the first record arrived\n`,
    );
    expect(text).toContain(
      `### messages\n\n${traceViewCatalog.messages.purpose}\n\n- session_id UUID\n- seq UInt32: Position of the block inside its session\n`,
    );
    // A view outside the catalog still lists its columns, with multi-line text flattened.
    expect(text).toContain(
      "### custom_view\n\n- value String: Added by a migration\n",
    );
  });

  // @req R-DASH-22
  it("covers the whole current catalog with every view, column, purpose and meaning, within a bounded size", () => {
    const text = formatSchemaContext(fullSchema);
    for (const view of [...traceViews, ...traceEmbeddingViews]) {
      expect(text).toContain(
        `### ${view}\n\n${traceViewCatalog[view].purpose}\n\n- `,
      );
      for (const [column, meaning] of Object.entries(
        traceViewCatalog[view].columns,
      ))
        expect(text).toContain(`- ${column} Nullable(String): ${meaning}\n`);
    }
    expect(formatSchemaContext(fullSchema)).toBe(text);
    // About 6k tokens for the complete schema (252 columns with type and meaning); keep it prompt-sized.
    expect(new TextEncoder().encode(text).length).toBeLessThan(32 * 1024);
  });

  // @req R-DASH-22
  it("describes table functions, relationships, patterns, three worked examples and the function allowlist", () => {
    const text = formatSchemaContext(schema);
    expect(text).toContain(
      "- `search_messages(q=String)` returns `session_id UUID, seq UInt32, rank Float64`. Visible lexical matches.",
    );
    expect(text).toContain("named literal parameters only");
    expect(text).toContain(
      "narrow `sessions` with `session_id IN (SELECT session_id FROM search_messages(q='words'))`, and read a hit's text from `messages` filtered to its literal `session_id` and `seq`",
    );
    expect(text).not.toContain(
      "JOIN messages AS m ON m.session_id = h.session_id",
    );
    expect(text).toContain("Per-session views join `sessions` on `session_id`");
    expect(text).toContain(
      "`sessions.parent_session_id` points at another `sessions.session_id`",
    );
    expect(text).toContain("`sessions.user_id` = `users.id`");
    expect(text).toContain("- Recent sessions:");
    expect(text).toContain("- Search messages by words:");
    expect(text).toContain("- Tool usage per repository:");
    expect(text).toContain("- Reuse of prior work:");
    expect(text.match(/```sql/g)).toHaveLength(3);
    for (const example of schemaContextExamples) {
      expect(text).toContain(
        `### ${example.title}\n\nAnswers: ${example.answers}\n\n\`\`\`sql\n${example.sql}\n\`\`\``,
      );
    }
    expect(text).toContain("## Allowed functions");
    for (const name of traceSqlFunctions) expect(text).toContain(name);
  });

  // @req R-DASH-22
  it("adds vector relationships, the similar_sessions pattern and vector functions only for embeddings-enabled callers", () => {
    const plain = formatSchemaContext(schema);
    for (const name of traceVectorFunctions) expect(plain).not.toContain(name);
    expect(plain).not.toContain("similar_sessions");
    const withEmbeddings = formatSchemaContext({
      columns: [
        ...schema.columns,
        {
          view_name: "session_embeddings",
          column_name: "embedding",
          data_type: "Array(Float32)",
          ordinal_position: 1,
          description: "Vector",
        },
      ],
      functions: [
        ...schema.functions,
        {
          function_name: "similar_sessions",
          arguments: "source=UUID, max_rows=UInt32",
          result_type: "session_id UUID, distance Float32",
          description: "Nearest sessions.",
        },
      ],
    });
    expect(withEmbeddings).toContain(
      "### session_embeddings\n\n" +
        traceViewCatalog.session_embeddings.purpose +
        "\n\n- embedding Array(Float32): Vector\n",
    );
    expect(withEmbeddings).toContain(
      "- `similar_sessions(source=UUID, max_rows=UInt32)` returns `session_id UUID, distance Float32`. Nearest sessions.",
    );
    expect(withEmbeddings).toContain(
      "`similar_sessions(source='session UUID', max_rows=5)` rows join `sessions` on `session_id`",
    );
    expect(withEmbeddings).toContain(
      "- Similar sessions: `FROM similar_sessions(",
    );
    expect(withEmbeddings).toContain(
      "With embeddings enabled, the vector functions `cosineDistance` and `L2Distance` are also allowed",
    );
    // Vector views alone (no similar_sessions function) still unlock the vector functions.
    const viewsOnly = formatSchemaContext({
      columns: [
        {
          view_name: "message_chunks",
          column_name: "embedding",
          data_type: "Array(Float32)",
          ordinal_position: 1,
          description: null,
        },
      ],
      functions: schema.functions,
    });
    expect(viewsOnly).toContain(
      "`cosineDistance` and `L2Distance` are also allowed",
    );
    expect(viewsOnly).not.toContain("- Similar sessions:");
  });

  // @req R-DASH-22
  it("ships examples that pass the same guard the query service applies", () => {
    const parameters = dashboardParameterTypes(standardDashboardVariables);
    expect(schemaContextExamples).toHaveLength(3);
    for (const example of schemaContextExamples) {
      expect(example.answers).toMatch(/^[A-Z].*\.$/);
      expect(guardTraceSql(example.sql, false, parameters)).toContain("SELECT");
    }
  });

  // @req R-DASH-22
  it("states when a caller has no table functions and drops the search recipe", () => {
    const text = formatSchemaContext({ ...schema, functions: [] });
    expect(text).toContain("None are available to this caller.");
    expect(text).not.toContain("named literal parameters");
    expect(text).not.toContain("`search_messages(q='words')` rows name");
    expect(text).toContain("hasTokenCaseInsensitive(content, 'word')");
  });
});
