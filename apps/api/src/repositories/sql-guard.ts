import { parse, type Statement } from "pgsql-ast-parser";
import { z } from "zod";
import { ServiceError } from "../services/context.js";

const readableViews = new Set([
  "sessions",
  "messages",
  "session_files",
  "session_observed_commits",
  "session_tools",
  "users",
  "installations",
  "repos",
  "schema_columns",
  "schema_functions",
  "reuse_edges",
  "session_reuse",
  "member_impact",
  "metrics_active_windows",
  "metrics_reads",
  "metrics_reuse_sessions",
  "metrics_reuse_weekly",
  "metrics_health",
  "metrics_capture",
  "metrics_activity",
  "metrics_redaction",
  "metrics_members",
  "metrics_usage",
  "metrics_mcp_calls",
  "metrics_dashboard",
  "metrics_outcomes",
  "metrics_own_zero_results",
]);
const functions = new Set([
  "count",
  "sum",
  "min",
  "max",
  "avg",
  "array_agg",
  "string_agg",
  "coalesce",
  "nullif",
  "lower",
  "upper",
  "length",
  "left",
  "right",
  "substring",
  "position",
  "now",
  "date_trunc",
  "to_char",
  "websearch_to_tsquery",
  "to_tsquery",
  "ts_rank_cd",
  "unnest",
  "generate_series",
  "jsonb_array_elements",
  "jsonb_array_elements_text",
  "jsonb_array_length",
  "jsonb_each",
  "jsonb_each_text",
  "jsonb_object_keys",
  "jsonb_extract_path",
  "jsonb_extract_path_text",
  "jsonb_typeof",
  "jsonb_build_array",
  "jsonb_build_object",
  "jsonb_agg",
  "jsonb_object_agg",
  // These are parsed as calls but are SQL expression syntax, not callable user functions.
  "exists",
  "any",
  "all",
]);
const scalarTypes = new Set([
  "text",
  "varchar",
  "character varying",
  "char",
  "character",
  "boolean",
  "bool",
  "smallint",
  "integer",
  "int",
  "int2",
  "int4",
  "bigint",
  "int8",
  "numeric",
  "decimal",
  "real",
  "float4",
  "float8",
  "double precision",
  "uuid",
  "date",
  "time",
  "timetz",
  "timestamp",
  "timestamptz",
  "timestamp with time zone",
  "timestamp without time zone",
  "interval",
  "json",
  "jsonb",
  "tsvector",
  "tsquery",
]);
const shapes: Readonly<Record<string, readonly string[]>> = {
  select: [
    "columns",
    "from",
    "where",
    "groupBy",
    "having",
    "limit",
    "orderBy",
    "distinct",
  ],
  union: ["left", "right"],
  "union all": ["left", "right"],
  values: ["values"],
  with: ["bind", "in"],
  "with recursive": ["alias", "columnNames", "bind", "in"],
  table: ["name", "join", "lateral"],
  statement: ["statement", "alias", "columnNames", "db", "join", "lateral"],
  call: [
    "function",
    "args",
    "distinct",
    "orderBy",
    "filter",
    "withinGroup",
    "over",
    "alias",
    "join",
    "lateral",
    "withOrdinality",
  ],
  ref: ["table", "name"],
  list: ["expressions"],
  array: ["expressions"],
  "array select": ["select"],
  arrayIndex: ["array", "index"],
  null: [],
  integer: ["value"],
  numeric: ["value"],
  string: ["value"],
  boolean: ["value"],
  extract: ["field", "from"],
  member: ["operand", "op", "member"],
  keyword: ["keyword"],
  case: ["value", "whens", "else"],
  binary: ["left", "right", "op"],
  unary: ["operand", "op"],
  cast: ["to", "operand"],
  constant: ["dataType", "value"],
  ternary: ["value", "lo", "hi", "op"],
  overlay: ["value", "placing", "from", "for"],
  substring: ["value", "from", "for"],
  "INNER JOIN": ["on", "using"],
  "LEFT JOIN": ["on", "using"],
  "RIGHT JOIN": ["on", "using"],
  "FULL JOIN": ["on", "using"],
  "CROSS JOIN": ["on", "using"],
};
const structureKeys = new Set([
  "name",
  "schema",
  "alias",
  "columnNames",
  "columns",
  "expr",
  "by",
  "order",
  "nulls",
  "limit",
  "offset",
  "orderBy",
  "partitionBy",
  "when",
  "value",
  "statement",
]);
const objectSchema = z.record(z.string(), z.unknown());
const binaryOperators = new Set([
  "OR",
  "AND",
  "IN",
  "NOT IN",
  "LIKE",
  "NOT LIKE",
  "ILIKE",
  "NOT ILIKE",
  "=",
  "!=",
  "<>",
  ">",
  ">=",
  "<",
  "<=",
  "@>",
  "<@",
  "?",
  "?|",
  "?&",
  "#>>",
  "~",
  "~*",
  "!~",
  "!~*",
  "@@",
  "||",
  "-",
  "#-",
  "&&",
  "+",
  "*",
  "%",
  "/",
  "|",
  "&",
  ">>",
  "^",
  "#",
  "<<",
  "AT TIME ZONE",
]);
const unaryOperators = new Set([
  "+",
  "-",
  "NOT",
  "IS NULL",
  "IS NOT NULL",
  "IS TRUE",
  "IS FALSE",
  "IS NOT TRUE",
  "IS NOT FALSE",
]);
function object(value: unknown): Record<string, unknown> {
  return objectSchema.parse(value);
}
function deny(message: string): never {
  throw new ServiceError(
    400,
    "SQL_NOT_ALLOWED",
    `${message} Query schema_columns for the available columns.`,
    { position: null },
  );
}
function name(value: unknown): { name: string; schema?: string | undefined } {
  const parsed = z
    .object({ name: z.string(), schema: z.string().optional() })
    .parse(value);
  return parsed;
}
function datatype(value: unknown): void {
  const node = object(value);
  if (node.kind === "array") {
    if (
      Object.keys(node)
        .filter((key) => key !== "_location")
        .some((key) => !["kind", "arrayOf"].includes(key))
    )
      deny("Unsupported array type.");
    datatype(node.arrayOf);
    return;
  }
  if (
    Object.keys(node)
      .filter((key) => key !== "_location")
      .some(
        (key) => !["name", "schema", "doubleQuoted", "config"].includes(key),
      )
  )
    deny("Unsupported type.");
  const type = name(node);
  if (type.schema || !scalarTypes.has(type.name))
    deny("This cast type is not allowed.");
  if (
    node.config !== undefined &&
    !z.array(z.number().int().nonnegative().max(10000)).safeParse(node.config)
      .success
  )
    deny("This type size is not allowed.");
}
function series(args: unknown): void {
  const values = z
    .array(z.object({ type: z.literal("integer"), value: z.number().int() }))
    .min(2)
    .max(3)
    .safeParse(args);
  if (!values.success)
    deny(
      "generate_series requires integer literal bounds and an optional positive integer step.",
    );
  const [start, end, step] = values.data;
  if (
    !start ||
    !end ||
    (step && step.value <= 0) ||
    end.value < start.value ||
    Math.floor((end.value - start.value) / (step?.value ?? 1)) + 1 > 10000
  )
    deny("generate_series is limited to 10000 values.");
}

/** Validate every AST child, including unknown fields, before the library serializes it. */
export function validateSqlAst(statement: Statement, embeddings = false): void {
  function visit(value: unknown, ctes: ReadonlySet<string>): void {
    if (value === null || value === undefined || typeof value !== "object")
      return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, ctes);
      return;
    }
    const node = object(value);
    const type = typeof node.type === "string" ? node.type : undefined;
    if (
      type === "binary" &&
      (typeof node.op !== "string" || !binaryOperators.has(node.op))
    )
      deny("This binary operator is not allowed.");
    if (
      type === "unary" &&
      (typeof node.op !== "string" || !unaryOperators.has(node.op))
    )
      deny("This unary operator is not allowed.");
    const keys = type ? shapes[type] : undefined;
    if (type && !keys) deny(`SQL node ${type} is not allowed.`);
    if (
      Object.keys(node)
        .filter((key) => key !== "_location")
        .some((key) =>
          type
            ? key !== "type" && !keys?.includes(key)
            : !structureKeys.has(key),
        )
    )
      deny("Unsupported SQL syntax.");
    if (type === "with") {
      const scope = new Set(ctes);
      const bindings = z.array(objectSchema).parse(node.bind);
      for (const binding of bindings) {
        if (
          Object.keys(binding)
            .filter((key) => key !== "_location")
            .some((key) => key !== "alias" && key !== "statement")
        )
          deny("Unsupported CTE syntax.");
        visit(binding.statement, scope);
        scope.add(name(binding.alias).name);
      }
      visit(node.in, scope);
      return;
    }
    if (type === "with recursive") {
      const scope = new Set(ctes).add(name(node.alias).name);
      visit(node.bind, scope);
      visit(node.in, scope);
      visit(node.columnNames, scope);
      return;
    }
    if (type === "table") {
      const relation = name(node.name);
      if (
        relation.schema
          ? relation.schema !== "api_ro" || !readableViews.has(relation.name)
          : !ctes.has(relation.name) && !readableViews.has(relation.name)
      )
        deny("Only api_ro views and local CTEs can be read.");
    }
    if (type === "ref" && node.table !== undefined) {
      const table = name(node.table);
      if (table.schema && table.schema !== "api_ro")
        deny("Only api_ro can be referenced.");
    }
    if (type === "call") {
      const fn = name(node.function);
      const apiFunction =
        fn.name === "search_messages" ||
        (embeddings && fn.name === "similar_sessions");
      if (
        fn.schema
          ? fn.schema !== "api_ro" || !apiFunction
          : !functions.has(fn.name) && !apiFunction
      )
        deny(`Function ${fn.name} is not allowed.`);
      if (fn.name === "generate_series") series(node.args);
    }
    if (type === "cast" || type === "constant")
      datatype(type === "cast" ? node.to : node.dataType);
    for (const [key, child] of Object.entries(node)) {
      if (
        key === "_location" ||
        key === "type" ||
        (type === "cast" && key === "to") ||
        (type === "constant" && key === "dataType")
      )
        continue;
      visit(child, ctes);
    }
  }
  if (
    !["select", "union", "union all", "with", "with recursive"].includes(
      statement.type,
    )
  )
    deny("Enter one SELECT or WITH SELECT statement.");
  visit(statement, new Set());
}

export function guardSql(sql: string, embeddings = false): string {
  let statements: Statement[];
  try {
    statements = parse(sql, { locationTracking: true });
  } catch {
    throw new ServiceError(
      400,
      "SQL_SYNTAX",
      "The SQL could not be parsed. Query schema_columns for the available columns. Recursive CTEs require explicit column names.",
      { position: null },
    );
  }
  const statement = statements[0];
  if (statements.length !== 1 || !statement)
    deny("Enter exactly one SELECT statement.");
  validateSqlAst(statement, embeddings);
  const location = statement._location;
  if (!location) deny("SQL source locations are unavailable.");
  // Keep decimal and bigint literals exact. AST reserialization uses JS numbers.
  return sql.slice(location.start, location.end);
}
