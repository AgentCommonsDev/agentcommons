import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { Play } from "lucide-react";
import { sqlOutputSchema } from "@agentcommons/core/schemas/sql";
import { formatSql } from "@agentcommons/core/format";
import type { JsonValue } from "@agentcommons/core/schemas/common";
import { copy } from "../copy";
import { api, unwrap } from "../lib/api/client";
import { textValue, number } from "../lib/display";
import { useWorkspace } from "../components/workspace/context";
import { DataTable } from "../components/workspace/data-table";
import {
  CopyButton,
  EmptyState,
  LoadingState,
  PageHeading,
  RequestError,
} from "../components/workspace/primitives";
import { Button } from "../components/ui/button";
export function SqlPage() {
  const { organization } = useWorkspace();
  const [sql, setSql] = useState<string>(copy.workspace.sql.initial);
  const [sorting, setSorting] = useState<SortingState>([]);
  const schema = useQuery({
    queryKey: [organization.id, "schema"],
    queryFn: async ({ signal }) =>
      unwrap(await api.GET("/api/v1/schema", { signal })),
  });
  const query = useMutation({
    mutationFn: async () =>
      sqlOutputSchema.parse(
        unwrap(await api.POST("/api/v1/query", { body: { sql } })),
      ),
  });
  const columns = useMemo<ColumnDef<JsonValue[]>[]>(
    () =>
      query.data?.columns.map((column, index) => ({
        id: String(index),
        header: column.name,
        accessorFn: (row) => row[index],
        enableSorting: false,
        cell: ({ getValue }) => textValue(getValue()),
      })) ?? [],
    [query.data],
  );
  const views = useMemo(() => {
    const map = new Map<string, NonNullable<typeof schema.data>["columns"]>();
    for (const column of schema.data?.columns ?? []) {
      const group = map.get(column.view_name) ?? [];
      group.push(column);
      map.set(column.view_name, group);
    }
    return map;
  }, [schema.data]);
  return (
    <>
      <PageHeading
        title={copy.workspace.sql.title}
        description={copy.workspace.sql.description}
      />
      <div className="sql-layout">
        <section
          className="sql-workbench"
          aria-label={copy.workspace.sql.editor}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              query.mutate();
            }}
          >
            <label htmlFor="sql-editor" className="sr-only">
              {copy.workspace.sql.editor}
            </label>
            <textarea
              id="sql-editor"
              className="sql-editor"
              value={sql}
              spellCheck={false}
              onChange={(event) => {
                setSql(event.target.value);
              }}
              onKeyDown={(event) => {
                if (
                  (event.ctrlKey || event.metaKey) &&
                  event.key === "Enter" &&
                  !query.isPending
                ) {
                  event.preventDefault();
                  query.mutate();
                }
              }}
            />
            <div className="sql-toolbar">
              <CopyButton value={sql} label={copy.workspace.sql.copy} />
              <Button type="submit" disabled={query.isPending || !sql.trim()}>
                <Play size={14} aria-hidden />
                {query.isPending
                  ? copy.workspace.sql.running
                  : copy.workspace.sql.run}
              </Button>
            </div>
          </form>
        </section>
        <aside className="schema-sidebar">
          <h2>{copy.workspace.sql.schema}</h2>
          {schema.isPending && <LoadingState />}
          {schema.error && (
            <RequestError
              error={schema.error}
              retry={() => {
                void schema.refetch();
              }}
            />
          )}
          {Array.from(views).map(([name, cols]) => (
            <details key={name}>
              <summary>{name}</summary>
              <dl>
                {cols.map((column) => (
                  <div key={column.column_name}>
                    <dt>{column.column_name}</dt>
                    <dd>{column.data_type}</dd>
                  </div>
                ))}
              </dl>
            </details>
          ))}
          {schema.data?.functions.length ? (
            <details>
              <summary>{copy.workspace.sql.functions}</summary>
              {schema.data.functions.map((fn) => (
                <div className="schema-function" key={fn.function_name}>
                  <strong>{fn.function_name}</strong>
                  <p>{fn.arguments}</p>
                  <span>{fn.result_type}</span>
                </div>
              ))}
            </details>
          ) : null}
        </aside>
      </div>
      {query.isPending && <LoadingState />}
      {query.error && <RequestError error={query.error} />}
      {query.data ? (
        <>
          <div className="sql-result-meta">
            <span>
              {number(query.data.row_count)}
              {copy.workspace.common.separator}
              {copy.workspace.common.rows}
            </span>
            <span>
              {number(query.data.duration_ms)}
              {copy.workspace.common.separator}
              {copy.workspace.fields.duration_ms}
            </span>
            <CopyButton value={formatSql(query.data).text} />
            {query.data.capped && <span>{copy.workspace.sql.capped}</span>}
            {query.data.truncated_cells.length > 0 && (
              <span>{copy.workspace.sql.truncated}</span>
            )}
          </div>
          <DataTable<JsonValue[]>
            data={query.data.rows}
            columns={columns}
            sorting={sorting}
            onSortingChange={setSorting}
            nextCursor={null}
            pageIndex={0}
            onNext={() => {}}
            onPrevious={() => {}}
            label={copy.workspace.sql.result}
            csvName={copy.workspace.sql.csvName}
            fetchExportPage={() =>
              Promise.resolve({ items: query.data.rows, cursor: null })
            }
          />
        </>
      ) : (
        !query.isPending &&
        !query.error && <EmptyState title={copy.workspace.sql.empty} />
      )}
    </>
  );
}
