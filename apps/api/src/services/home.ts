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
  searchAdoptionSchema,
  type HomeItem,
  homeListPositionSchema,
  reusePagePositionSchema,
  reuseListInputSchema,
} from "@agentcommons/core";
import { Parameters, reuseEdgePage } from "../repositories/read-model.js";
import { searchAdoptionSelect } from "../repositories/search-adoption.js";
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
          SELECT addWeeks(subtractWeeks(toMonday(now('UTC')),7),arrayJoin(range(8))) AS week)
          SELECT toString(w.week) AS week,toFloat64(coalesce(r.sessions,0)) AS sessions,
            toFloat64(coalesce(r.reuse_sessions,0)) AS reuse_sessions,
            toFloat64(coalesce(r.cross_user_reuse_sessions,0)) AS cross_user_reuse_sessions,
            toFloat64(r.reuse_rate) AS reuse_rate,toFloat64(r.cross_user_reuse_rate) AS cross_user_reuse_rate
          FROM weeks w LEFT JOIN api_ro.metrics_reuse_weekly r USING(week) ORDER BY w.week`);
          const trend = z.array(reuseWeekSchema).length(8).parse(weekly.rows);
          const impact = await client.query(
            `SELECT user_id,toFloat64(sessions_reused_by_others) AS sessions_reused_by_others,
          toFloat64(distinct_readers) AS distinct_readers,toFloat64(reuses_made) AS reuses_made
          FROM api_ro.member_impact WHERE user_id={user:String}`,
            { user: caller.userId },
          );
          const adoption = await client.query(`SELECT ${searchAdoptionSelect}
            FROM api_ro.metrics_search_sessions t
            WHERE started_at>=toMonday(now('UTC'))
              AND started_at<addWeeks(toMonday(now('UTC')),1)`);
          return homeSummarySchema.parse({
            week: trend.at(-1)?.week,
            weekly: trend,
            search_adoption: searchAdoptionSchema.parse(adoption.rows[0]),
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
            const values = new Parameters();
            const cutoff = `parseDateTime64BestEffort(${values.add(checkpoint.at)},6,'UTC')`;
            const limit = values.add(request.limit + 1);
            const afterValue = values.add(
              after?.value ?? null,
              numeric ? "Nullable(Float64)" : "Nullable(String)",
            );
            const afterId = values.add(after?.id ?? null, "Nullable(String)");
            const query = values.add(request.query ?? null, "Nullable(String)");
            const source =
              section === "gap_repos"
                ? `SELECT repo_name,toFloat64(count(*)) AS sessions
            FROM api_ro.metrics_reuse_sessions WHERE started_at<=${cutoff} AND repo_name IS NOT NULL
            GROUP BY repo_name HAVING countIf(reused)=0`
                : `SELECT search_id,searched_at,query FROM api_ro.metrics_own_zero_results
            WHERE searched_at>=toMonday(${cutoff}) AND searched_at<=${cutoff}`;
            const value =
              sort === "searched_at"
                ? "formatDateTime(searched_at,'%Y-%m-%dT%H:%i:%S.%fZ','UTC')"
                : numeric
                  ? "sessions"
                  : `substringUTF8(${sort},1,256)`;
            const identity =
              section === "gap_repos"
                ? "lower(hex(SHA256(repo_name)))"
                : "toString(search_id)";
            const seek = `(position_value ${request.order === "asc" ? ">" : "<"} ${afterValue} OR (position_value=${afterValue} AND position_id>${afterId}))`;
            const filterField = section === "gap_repos" ? "repo_name" : "query";
            const result = await client.query(
              `WITH source AS (${source}), positioned AS (
            SELECT *,${value} AS position_value,${identity} AS position_id FROM source)
            SELECT * FROM positioned WHERE (${afterId} IS NULL OR (${seek}))
              AND (${query} IS NULL OR positionCaseInsensitiveUTF8(${filterField},${query})>0)
            ORDER BY position_value ${request.order} NULLS LAST,position_id LIMIT ${limit}`,
              values.values,
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
