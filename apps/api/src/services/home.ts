import { z } from "zod";
import {
  homeCursorSchema,
  homeInputSchema,
  homeOutputSchema,
  homeSectionSchema,
  homeSectionSort,
  homeSummarySchema,
  homeRepoGapSchema,
  homeZeroResultSchema,
  reuseWeekSchema,
  memberImpactSchema,
  type HomeItem,
  homeListPositionSchema,
  reusePagePositionSchema,
  reuseListInputSchema,
} from "@agentcommons/core";
import { reuseEdgePage } from "../repositories/read-model.js";
import { readOperation, type ReadDependencies } from "./read-operation.js";
import { ServiceError, type ServiceContext } from "./context.js";
import {
  boundedPage,
  wireValue,
  wireRow,
  compactMetadata,
} from "./read-budget.js";

export class HomeService {
  constructor(private readonly dependencies: ReadDependencies) {}

  summary(context: ServiceContext) {
    return readOperation(
      this.dependencies.audit,
      context,
      { action: "home", resourceType: "reuse" },
      async (caller) => {
        return this.dependencies.readers.read(caller, async (client) => {
          const weekly = await client.query(`WITH weeks AS (
          SELECT generate_series(date_trunc('week',now() AT TIME ZONE 'UTC')-interval '7 weeks',
            date_trunc('week',now() AT TIME ZONE 'UTC'),interval '1 week')::date AS week)
          SELECT w.week::text,coalesce(r.sessions,0)::float8 AS sessions,
            coalesce(r.reuse_sessions,0)::float8 AS reuse_sessions,
            coalesce(r.cross_user_reuse_sessions,0)::float8 AS cross_user_reuse_sessions,
            r.reuse_rate::float8,r.cross_user_reuse_rate::float8
          FROM weeks w LEFT JOIN api_ro.metrics_reuse_weekly r USING(week) ORDER BY w.week`);
          const trend = z.array(reuseWeekSchema).length(8).parse(weekly.rows);
          const impact = await client.query(
            `SELECT user_id,sessions_reused_by_others::float8,
          distinct_readers::float8,reuses_made::float8 FROM api_ro.member_impact WHERE user_id=$1`,
            [caller.userId],
          );
          return homeSummarySchema.parse({
            week: trend.at(-1)?.week,
            weekly: trend,
            impact: memberImpactSchema.parse(
              impact.rows[0] ?? {
                user_id: caller.userId,
                sessions_reused_by_others: 0,
                distinct_readers: 0,
                reuses_made: 0,
              },
            ),
          });
        });
      },
    );
  }

  list(context: ServiceContext, sectionInput: unknown, input: unknown) {
    return readOperation(
      this.dependencies.audit,
      context,
      {
        action: "home.list",
        resourceType: "reuse",
        detail: { section: sectionInput, input },
      },
      async (caller) => {
        const section = homeSectionSchema.parse(sectionInput);
        const request = homeInputSchema.parse(input);
        const gaps = section === "gap_repos" || section === "zero_results";
        if (request.reader_user_id && gaps)
          throw new ServiceError(
            400,
            "INVALID_FILTER",
            "Reader filters apply to reuse activity.",
          );
        if (request.query && !gaps)
          throw new ServiceError(
            400,
            "INVALID_FILTER",
            "Text filters apply to gaps.",
          );
        const { cursor, ...parameters } = request;
        const binding = wireValue({
          caller,
          section,
          input: parameters,
          operation: "home.list",
        });
        const checkpoint = cursor
          ? this.dependencies.cursors.decode(cursor, binding, homeCursorSchema)
          : { at: new Date().toISOString(), after: null };
        const allowed: readonly string[] = homeSectionSort[section];
        const sort = request.sort ?? allowed[0];
        if (!sort || !allowed.includes(sort))
          throw new ServiceError(
            400,
            "INVALID_SORT",
            "This sort field is not available for this list.",
          );
        const entries = await this.dependencies.readers.read(
          caller,
          async (client) => {
            if (
              section === "reused" ||
              section === "inbound" ||
              section === "outbound"
            ) {
              return reuseEdgePage(client, {
                scope: { home: section, userId: caller.userId },
                asOf: checkpoint.at,
                sort: reuseListInputSchema.shape.sort.parse(sort) ?? "read_at",
                order: request.order,
                ...(request.reader_user_id
                  ? { readerUserId: request.reader_user_id }
                  : {}),
                after:
                  checkpoint.after === null
                    ? null
                    : reusePagePositionSchema.parse(checkpoint.after),
                limit: request.limit + 1,
              });
            }
            const after =
              checkpoint.after === null
                ? null
                : homeListPositionSchema.parse(checkpoint.after);
            const numeric = sort === "sessions";
            const source =
              section === "gap_repos"
                ? `SELECT repo_name,count(*)::float8 AS sessions
            FROM api_ro.metrics_reuse_sessions WHERE started_at<=$1::timestamptz AND repo_name IS NOT NULL
            GROUP BY repo_name HAVING NOT bool_or(reused)`
                : `SELECT search_id,searched_at,query FROM api_ro.metrics_own_zero_results
            WHERE searched_at>=date_trunc('week',$1::timestamptz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AND searched_at<=$1::timestamptz`;
            const value =
              sort === "searched_at"
                ? `to_char(searched_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
                : numeric
                  ? "sessions"
                  : `left(${sort},256)`;
            const identity =
              section === "gap_repos"
                ? "encode(sha256(convert_to(repo_name,'UTF8')),'hex')"
                : "search_id::text";
            const compare = numeric
              ? "position_value"
              : 'position_value COLLATE "C"';
            const parameter = numeric ? "$3::float8" : '$3::text COLLATE "C"';
            const seek = `(${compare} ${request.order === "asc" ? ">" : "<"} ${parameter} OR (${compare}=${parameter} AND position_id>$4))`;
            const filterField = section === "gap_repos" ? "repo_name" : "query";
            const result = await client.query<Record<string, unknown>>(
              `WITH source AS (${source}), positioned AS (
            SELECT *,${value} AS position_value,${identity} AS position_id FROM source)
            SELECT * FROM positioned WHERE ($4::text IS NULL OR (${seek}))
              AND ($5::text IS NULL OR strpos(lower(${filterField}),lower($5))>0)
            ORDER BY ${compare} ${request.order} NULLS LAST,position_id LIMIT $2`,
              [
                checkpoint.at,
                request.limit + 1,
                after?.value ?? null,
                after?.id ?? null,
                request.query ?? null,
              ],
            );
            return result.rows.map((row) => {
              const { position_value, position_id, ...item } = wireRow(row);
              return {
                item:
                  section === "gap_repos"
                    ? homeRepoGapSchema.parse(
                        compactMetadata(item, ["repo_name"]),
                      )
                    : homeZeroResultSchema.parse(
                        compactMetadata(item, ["query"]),
                      ),
                position: homeListPositionSchema.parse({
                  value: position_value,
                  id: position_id,
                }),
              };
            });
          },
        );
        const items: HomeItem[] = entries
          .slice(0, request.limit)
          .map((entry) => entry.item);
        const page = boundedPage(
          items,
          entries.length > request.limit,
          (_last, count) =>
            this.dependencies.cursors.encode(
              binding,
              homeCursorSchema.parse({
                at: checkpoint.at,
                after: entries[count - 1]?.position,
              }),
            ),
        );
        return homeOutputSchema.parse(page);
      },
      (result) => ({ rows: result.items.length }),
    );
  }
}
