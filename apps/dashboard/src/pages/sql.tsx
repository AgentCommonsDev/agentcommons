import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { sqlOutputSchema } from "@agentcommons/core/schemas/sql";
import { formatJson } from "@agentcommons/core/format";
import { copy } from "../copy";
import { api, unwrap } from "../lib/api/client";
import { useWorkspace } from "../components/workspace/context";
import { SqlResult } from "../components/workspace/sql-result";
import {
  CopyButton,
  Field,
  EmptyState,
  LoadingState,
  PageHeading,
  RequestError,
} from "../components/workspace/primitives";
import { Button } from "../components/ui/button";
import { SqlEditor } from "../components/workspace/sql-editor";
export function SqlPage() {
  const { organization } = useWorkspace();
  const [selectedView, setSelectedView] = useState("sessions");
  const [sql, setSql] = useState<string>(copy.workspace.sql.initial);
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
            <SqlEditor
              value={sql}
              onChange={(value) => {
                setSql(value);
                if (query.error) query.reset();
              }}
              onRun={() => {
                query.mutate();
              }}
              schema={schema.data}
              disabled={query.isPending}
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
          {query.error && <RequestError error={query.error} />}
        </section>
      </div>
      <section
        className="sql-schema-panel"
        aria-label={copy.workspace.sql.schema}
      >
        <div className="sql-schema-heading">
          <h2>{copy.workspace.sql.schema}</h2>
          {schema.data && (
            <CopyButton
              value={formatJson(schema.data).text}
              label={copy.workspace.sql.copySchema}
              showLabel
            />
          )}
        </div>
        <p>{copy.workspace.sql.schemaHint}</p>
        {schema.isPending && <LoadingState />}
        {schema.error && (
          <RequestError
            error={schema.error}
            retry={() => {
              void schema.refetch();
            }}
          />
        )}
        {schema.data && (
          <details className="sql-schema-browser">
            <summary>{copy.workspace.sql.showSchema}</summary>
            <Field label={copy.workspace.sql.schemaView}>
              {(props) => (
                <select
                  {...props}
                  value={
                    views.has(selectedView) || selectedView === "__functions"
                      ? selectedView
                      : (views.keys().next().value ?? "")
                  }
                  onChange={(event) => {
                    setSelectedView(event.target.value);
                  }}
                >
                  {Array.from(views.keys()).map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                  <option value="__functions">
                    {copy.workspace.sql.functions}
                  </option>
                </select>
              )}
            </Field>
            <dl
              className="sql-schema-fields"
              tabIndex={0}
              aria-label={copy.workspace.sql.schema}
            >
              {selectedView === "__functions"
                ? schema.data.functions.map((fn) => (
                    <div key={fn.function_name}>
                      <dt>{fn.function_name}</dt>
                      <dd>
                        <code>{fn.arguments}</code>
                        <span>{fn.result_type}</span>
                        {fn.description && <p>{fn.description}</p>}
                      </dd>
                    </div>
                  ))
                : (
                    views.get(selectedView) ??
                    views.values().next().value ??
                    []
                  ).map((column) => (
                    <div key={column.column_name}>
                      <dt>{column.column_name}</dt>
                      <dd>
                        <code>{column.data_type}</code>
                        {column.description && <p>{column.description}</p>}
                      </dd>
                    </div>
                  ))}
            </dl>
          </details>
        )}
      </section>
      {query.isPending && <LoadingState />}
      {query.data ? (
        <SqlResult data={query.data} />
      ) : (
        !query.isPending &&
        !query.error && <EmptyState title={copy.workspace.sql.empty} />
      )}
    </>
  );
}
