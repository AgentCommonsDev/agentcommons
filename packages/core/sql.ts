import { format, parse, ParseError, type Statement } from "@clickhouse/parser";
import { utf8ByteLength } from "./schemas/common.js";
import { sqlLimits } from "./schemas/sql.js";
export {
  parse as parseTraceSql,
  ParseError as TraceSqlParseError,
} from "@clickhouse/parser";

export const traceViews = [
  "sessions",
  "messages",
  "session_files",
  "session_observed_commits",
  "session_observed_branches",
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
  "metrics_search_sessions",
  "metrics_reuse_weekly",
  "metrics_reuse_outcomes",
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
] as const;
/** Vector views that exist for every caller but are visible only with embeddings enabled. */
export const traceEmbeddingViews = [
  "message_chunks",
  "session_embeddings",
] as const;
/** Vector distance functions the guard admits only with embeddings enabled. */
export const traceVectorFunctions = ["cosineDistance", "L2Distance"] as const;
const vectorFunctions = new Set<string>(
  traceVectorFunctions.map((name) => name.toLowerCase()),
);
/** The guard's rejection when a query needs embeddings the caller does not have; adapters add who can change that. */
export const embeddingsRequiredMessage = (capability: string) =>
  `${capability} needs embeddings, which are not enabled for this organization. Use search_messages(q='words') for keyword search.`;
export {
  traceViewCatalog,
  traceColumnDescriptions,
  sessionReadAggregateColumns,
  type TraceViewName,
  type TraceViewDescription,
} from "./schema-catalog.js";

/** Reviewed scalar/aggregate functions; never table, network or file functions. */
export const traceSqlFunctions = [
  "count",
  "countIf",
  "sum",
  "sumIf",
  "min",
  "max",
  "avg",
  "avgIf",
  "uniq",
  "uniqExact",
  "uniqIf",
  "uniqExactIf",
  "argMax",
  "argMin",
  "any",
  "anyLast",
  "groupArray",
  "groupUniqArray",
  "quantile",
  "quantileExact",
  "quantileExactIf",
  "median",
  "medianExact",
  "stddevPop",
  "stddevSamp",
  "coalesce",
  "ifNull",
  "nullIf",
  "if",
  "multiIf",
  "isNull",
  "isNotNull",
  "assumeNotNull",
  "lower",
  "lowerUTF8",
  "upper",
  "upperUTF8",
  "length",
  "lengthUTF8",
  "empty",
  "notEmpty",
  "substring",
  "substringUTF8",
  "left",
  "right",
  "concat",
  "replaceAll",
  "repeat",
  "trim",
  "trimBoth",
  "startsWith",
  "endsWith",
  "position",
  "positionCaseInsensitive",
  "positionCaseInsensitiveUTF8",
  "match",
  "hasToken",
  "hasTokenCaseInsensitive",
  "hasAllTokens",
  "hasAnyTokens",
  "tokens",
  "array",
  "range",
  "arrayJoin",
  "tuple",
  "tupleElement",
  "arrayElement",
  "arrayDistinct",
  "arraySort",
  "arraySlice",
  "arrayConcat",
  "arrayFilter",
  "arrayMap",
  "arrayExists",
  "arrayCount",
  "arraySum",
  "has",
  "hasAny",
  "hasAll",
  "indexOf",
  "mapKeys",
  "mapValues",
  "mapContains",
  "map",
  "JSONExtract",
  "JSONExtractString",
  "JSONExtractRaw",
  "JSONExtractInt",
  "JSONExtractUInt",
  "JSONExtractFloat",
  "JSONExtractBool",
  "JSONExtractArrayRaw",
  "JSONExtractKeysAndValuesRaw",
  "JSONHas",
  "JSONType",
  "JSONLength",
  "toJSONString",
  "isValidJSON",
  "now",
  "now64",
  "today",
  "toDate",
  "toDateTime",
  "toDateTime64",
  "toStartOfDay",
  "toStartOfWeek",
  "toStartOfMonth",
  "toStartOfHour",
  "toMonday",
  "dateTrunc",
  "dateDiff",
  "dateAdd",
  "dateSub",
  "formatDateTime",
  "toUnixTimestamp",
  "toUnixTimestamp64Milli",
  "toYear",
  "toMonth",
  "toDayOfMonth",
  "toDayOfWeek",
  "toHour",
  "toIntervalDay",
  "toIntervalWeek",
  "toIntervalMonth",
  "toIntervalSecond",
  "parseDateTimeBestEffort",
  "toString",
  "toUUID",
  "toUInt8",
  "toUInt32",
  "toUInt64",
  "toInt32",
  "toInt64",
  "toFloat32",
  "toFloat64",
  "toDecimal64",
  "toDecimal128",
  "CAST",
  "accurateCast",
  "round",
  "floor",
  "ceil",
  "abs",
  "greatest",
  "least",
  "intDiv",
  "modulo",
  "plus",
  "minus",
  "multiply",
  "divide",
  "negate",
  "equals",
  "notEquals",
  "less",
  "lessOrEquals",
  "greater",
  "greaterOrEquals",
  "and",
  "or",
  "not",
  "in",
  "notIn",
  "like",
  "notLike",
  "ilike",
  "notILike",
  "exists",
  "between",
  "notBetween",
  "lambda",
  "row_number",
  "rank",
  "dense_rank",
  "lagInFrame",
  "leadInFrame",
  "first_value",
  "last_value",
] as const;
const allowedFunctions = new Set<string>(
  traceSqlFunctions.map((name) => name.toLowerCase()),
);
const allowedViews = new Set<string>(traceViews);
const embeddingViews = new Set<string>(traceEmbeddingViews);
const nodes = new Set([
  "SelectWithUnionQuery",
  "SelectIntersectExceptQuery",
  "SelectQuery",
  "WithElement",
  "Subquery",
  "TablesInSelectQuery",
  "TablesInSelectQueryElement",
  "TableExpression",
  "TableIdentifier",
  "TableJoin",
  "Identifier",
  "Literal",
  "Function",
  "Asterisk",
  "QualifiedAsterisk",
  "ExpressionList",
  "OrderByElement",
  "WindowDefinition",
  "WindowListElement",
  "Unbounded",
  "Current",
  "Offset",
  "DataType",
  "QueryParameter",
]);
/** ClickHouse spells parameter types with optional whitespace; compare a canonical form. */
const canonicalType = (value: string) =>
  value.replaceAll(/\s+/g, "").toLowerCase();
export class TraceSqlError extends Error {
  /**
   * @param capability the vector view, table function or function the query used while
   * embeddings were off, so the server can say why they are off; null for every other rejection.
   */
  constructor(
    message: string,
    readonly position: number | null = null,
    readonly capability: string | null = null,
  ) {
    super(message);
  }
}
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
function visit(
  value: unknown,
  callback: (value: Record<string, unknown>) => void,
) {
  if (Array.isArray(value)) {
    for (const entry of value) visit(entry, callback);
    return;
  }
  const node = object(value);
  if (!node) return;
  callback(node);
  for (const [key, entry] of Object.entries(node))
    if (
      !["location", "leadingComments", "trailingComments", "parent"].includes(
        key,
      )
    )
      visit(entry, callback);
}
function fail(
  node: Record<string, unknown>,
  message: string,
  capability: string | null = null,
): never {
  const offset = object(object(node.location)?.start)?.offset;
  throw new TraceSqlError(
    message,
    typeof offset === "number" ? offset + 1 : null,
    capability,
  );
}
/** A vector capability was used without embeddings: name it instead of a generic rejection. */
function failEmbeddings(
  node: Record<string, unknown>,
  capability: string,
): never {
  fail(node, embeddingsRequiredMessage(capability), capability);
}

/**
 * Serialize the vetted AST so syntax discarded by the parser never reaches the server.
 * `parameters` maps declared ClickHouse query parameters (dashboard variables) to their
 * required types; every other `{name:Type}` reference is rejected.
 */
export function guardTraceSql(
  sql: string,
  embeddings = false,
  parameters: Readonly<Record<string, string>> = {},
): string {
  if (utf8ByteLength(sql) > sqlLimits.sqlBytes)
    throw new TraceSqlError(
      `Keep the query within ${String(sqlLimits.sqlBytes / 1024)} KB.`,
    );
  let ast: Statement[];
  try {
    ast = parse(sql);
  } catch (error) {
    if (error instanceof ParseError)
      throw new TraceSqlError(
        "The query has invalid ClickHouse SQL syntax.",
        error.location.start.offset + 1,
      );
    throw error;
  }
  if (
    ast.length !== 1 ||
    !["SelectWithUnionQuery", "SelectIntersectExceptQuery"].includes(
      ast[0]?.type ?? "",
    )
  )
    throw new TraceSqlError("Run one SELECT query over the available views.");
  const bindings = new Set<string>();
  const parameterizedViews = new Set<Record<string, unknown>>();
  visit(ast, (node) => {
    if (node.type === "WithElement" && typeof node.name === "string")
      bindings.add(node.name);
  });
  visit(ast, (node) => {
    // SQL is embedded in a bounded SELECT. Comments cannot carry a terminal delimiter into it.
    delete node.leadingComments;
    delete node.trailingComments;
    if (typeof node.type === "string" && !nodes.has(node.type))
      fail(
        node,
        "This SQL construct is unavailable. Use the schema browser for supported queries.",
      );
    if (
      node.settings !== undefined ||
      node.out_file !== undefined ||
      node.format !== undefined ||
      node.outfile_truncate !== undefined
    )
      fail(
        node,
        "Query settings and output destinations are managed by the server.",
      );
    if (node.type === "TableExpression" && node.table_function !== undefined) {
      const fn = object(node.table_function);
      const name = fn?.name;
      if (!embeddings && name === "similar_sessions")
        failEmbeddings(node, "similar_sessions");
      const expected =
        name === "search_messages"
          ? ["q"]
          : embeddings && name === "similar_sessions"
            ? ["source", "max_rows"]
            : null;
      if (
        !fn ||
        !expected ||
        !Array.isArray(fn.arguments) ||
        fn.arguments.length !== expected.length
      )
        fail(
          node,
          "Use search_messages(q='text') or an available view from the schema browser.",
        );
      const provided = new Set<string>();
      for (const argument of fn.arguments) {
        const assignment = object(argument);
        const pair = assignment?.arguments;
        const left = Array.isArray(pair) ? object(pair[0]) : null;
        const right = Array.isArray(pair) ? object(pair[1]) : null;
        const key = left?.name;
        if (
          assignment?.name !== "equals" ||
          !Array.isArray(pair) ||
          pair.length !== 2 ||
          left?.type !== "Identifier" ||
          typeof key !== "string" ||
          !expected.includes(key) ||
          provided.has(key) ||
          right?.type !== "Literal"
        )
          fail(node, "Pass named, literal parameters to the search view.");
        provided.add(key);
      }
      parameterizedViews.add(fn);
    }
    if (node.type === "TableIdentifier") {
      const name = typeof node.name === "string" ? node.name : "";
      if (
        !embeddings &&
        (node.database === undefined || node.database === "api_ro") &&
        embeddingViews.has(name) &&
        !bindings.has(name)
      )
        failEmbeddings(node, name);
      if (
        (node.database !== undefined && node.database !== "api_ro") ||
        (!allowedViews.has(name) &&
          !(embeddings && embeddingViews.has(name)) &&
          !(node.database === undefined && bindings.has(name)))
      )
        fail(node, "Select from the views listed in the schema browser.");
    }
    if (node.type === "QueryParameter") {
      const name = typeof node.name === "string" ? node.name : "";
      const declared = parameters[name];
      if (declared === undefined)
        fail(
          node,
          `Parameter {${name}} is not declared. Declare a dashboard variable with that name or remove it.`,
        );
      else if (
        canonicalType(
          typeof node.param_type === "string" ? node.param_type : "",
        ) !== canonicalType(declared)
      )
        fail(node, `Parameter {${name}} must use the type ${declared}.`);
    }
    if (node.type === "Function") {
      const name = typeof node.name === "string" ? node.name.toLowerCase() : "";
      if (!embeddings && vectorFunctions.has(name))
        failEmbeddings(node, typeof node.name === "string" ? node.name : name);
      if (
        !parameterizedViews.has(node) &&
        !allowedFunctions.has(name) &&
        !(embeddings && vectorFunctions.has(name))
      )
        fail(
          node,
          "This SQL function is unavailable. Use the functions listed in the schema browser.",
        );
    }
  });
  return format(ast).trim().replace(/;$/, "");
}
