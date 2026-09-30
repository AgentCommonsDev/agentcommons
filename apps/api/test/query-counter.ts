import type {
  TraceParameters,
  TraceReaders,
  TraceReadClient,
} from "@agentcommons/traces";

/** One recorded ClickHouse query and the `api_ro` relations its text names. */
interface RecordedQuery {
  sql: string;
  parameters: TraceParameters;
  relations: string[];
}
/**
 * The real `TraceReaders` with every ClickHouse query of a read callback recorded, so a
 * test can assert how many scans one request issues and which relations they name. The
 * fence, principal and settings are the production ones; only the client is wrapped.
 */
export function countingReaders(readers: TraceReaders) {
  const queries: Array<{ sql: string; parameters: TraceParameters }> = [];
  const proxy = new Proxy(readers, {
    get(target, property, receiver): unknown {
      if (property !== "read") return Reflect.get(target, property, receiver);
      const read: TraceReaders["read"] = (caller, operation) =>
        target.read(caller, (client) =>
          operation({
            control: client.control,
            query: <Row extends Record<string, unknown>>(
              sql: string,
              parameters?: TraceParameters,
            ) => {
              queries.push({ sql, parameters: parameters ?? {} });
              return client.query<Row>(sql, parameters);
            },
          } satisfies TraceReadClient),
        );
      return read;
    },
  });
  return {
    readers: proxy,
    /** The queries recorded since the previous call, oldest first. */
    drain(): RecordedQuery[] {
      return queries.splice(0).map(({ sql, parameters }) => ({
        sql,
        parameters,
        relations: [
          ...new Set(
            [...sql.matchAll(/api_ro\.(\w+)/g)].map((match) => match[1] ?? ""),
          ),
        ],
      }));
    },
  };
}
/** How many recorded queries name each relation: the scans per relation of one request. */
export function scansPerRelation(
  queries: readonly RecordedQuery[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const query of queries)
    for (const relation of query.relations)
      counts[relation] = (counts[relation] ?? 0) + 1;
  return counts;
}
