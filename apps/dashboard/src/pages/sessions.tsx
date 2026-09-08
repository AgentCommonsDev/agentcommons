import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Search, X } from "lucide-react";
import { searchFiltersSchema } from "@agentcommons/core/schemas/search";
import { formatSearch } from "@agentcommons/core/format";
import { copy } from "../copy";
import { api, unwrap, defined } from "../lib/api/client";
import { searchFilterKeys, sessionSortKeys } from "../lib/api/options";
import { dateTime, number, textValue, harnessLabel } from "../lib/display";
import { usePagination } from "../lib/pagination";
import type { SessionItem } from "../lib/types";
import { useWorkspace } from "../components/workspace/context";
import { DataTable } from "../components/workspace/data-table";
import {
  CopyButton,
  EmptyState,
  LoadingState,
  PageHeading,
  RequestError,
  StatusBadge,
  ShortenedFields,
} from "../components/workspace/primitives";
import { Button } from "../components/ui/button";

export function sessionColumns(): ColumnDef<SessionItem>[] {
  return [
    {
      accessorKey: "title",
      header: copy.workspace.fields.title,
      cell: ({ row }) => (
        <a className="table-cell-title" href={`/s/${row.original.session_id}`}>
          {row.original.title ?? copy.workspace.sessions.untitled}
        </a>
      ),
    },
    {
      accessorKey: "harness",
      header: copy.workspace.fields.harness,
      cell: ({ row }) => harnessLabel(row.original.harness),
    },
    {
      accessorKey: "harness_version",
      header: copy.workspace.fields.harness_version,
      cell: ({ getValue }) => textValue(getValue()),
    },
    {
      accessorKey: "model",
      header: copy.workspace.fields.model,
      cell: ({ getValue }) => textValue(getValue()),
    },
    {
      accessorKey: "repo_name",
      header: copy.workspace.fields.repo_name,
      cell: ({ getValue }) => textValue(getValue()),
    },
    {
      accessorKey: "branch",
      header: copy.workspace.fields.branch,
      cell: ({ getValue }) => textValue(getValue()),
    },
    { accessorKey: "user_email", header: copy.workspace.fields.user_email },
    {
      accessorKey: "installation_hostname",
      header: copy.workspace.fields.installation_hostname,
    },
    {
      accessorKey: "started_at",
      header: copy.workspace.fields.started_at,
      cell: ({ row }) => dateTime(row.original.started_at),
    },
    {
      accessorKey: "duration_seconds",
      header: copy.workspace.fields.duration_seconds,
      cell: ({ row }) => number(row.original.duration_seconds),
    },
    {
      accessorKey: "message_count",
      header: copy.workspace.fields.message_count,
      cell: ({ row }) => number(row.original.message_count),
    },
    {
      accessorKey: "tool_call_count",
      header: copy.workspace.fields.tool_call_count,
      cell: ({ row }) => number(row.original.tool_call_count),
    },
    {
      accessorKey: "observed_commit_count",
      header: copy.workspace.fields.observed_commit_count,
      cell: ({ row }) => number(row.original.observed_commit_count),
    },
    {
      accessorKey: "reuse_count",
      header: copy.workspace.fields.reuse_count,
      cell: ({ row }) => number(row.original.reuse_count),
    },
    {
      accessorKey: "status",
      header: copy.workspace.fields.status,
      cell: ({ row }) => <StatusBadge value={row.original.status} />,
    },
  ];
}
export function FilterChips({
  filters,
  onChange,
}: {
  filters: Record<string, string | string[]>;
  onChange: (value: Record<string, string | string[]>) => void;
}) {
  const [field, setField] = useState<string>(searchFilterKeys[0]);
  const [value, setValue] = useState("");
  const labels: Record<string, string> = copy.workspace.fields;
  return (
    <>
      <form
        className="filter-row"
        onSubmit={(event) => {
          event.preventDefault();
          if (value.trim()) {
            const existing = filters[field];
            const values =
              existing === undefined
                ? []
                : Array.isArray(existing)
                  ? existing
                  : [existing];
            onChange({
              ...filters,
              [field]: [...new Set([...values, value.trim()])],
            });
            setValue("");
          }
        }}
      >
        <select
          aria-label={copy.workspace.sessions.filterField}
          value={field}
          onChange={(event) => {
            setField(event.target.value);
          }}
        >
          {searchFilterKeys.map((key) => (
            <option value={key} key={key}>
              {labels[key] ?? key}
            </option>
          ))}
        </select>
        <input
          aria-label={copy.workspace.sessions.filterValue}
          placeholder={labels[field] ?? field}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
          }}
        />
        <Button type="submit" variant="secondary" disabled={!value.trim()}>
          {copy.workspace.sessions.addFilter}
        </Button>
      </form>
      <div className="filter-chips">
        {Object.entries(filters).flatMap(([key, values]) =>
          (Array.isArray(values) ? values : [values]).map((content) => (
            <span className="filter-chip" key={`${key}:${content}`}>
              {labels[key] ?? key}
              {copy.workspace.common.separator}
              {content}
              <Button
                variant="ghost"
                size="icon"
                aria-label={`${copy.workspace.sessions.removeFilter} ${labels[key] ?? key}`}
                onClick={() => {
                  const remaining = (
                    Array.isArray(values) ? values : [values]
                  ).filter((item) => item !== content);
                  onChange(
                    Object.fromEntries(
                      Object.entries(filters).flatMap(([name, entry]) =>
                        name !== key
                          ? [[name, entry]]
                          : remaining.length > 0
                            ? [[name, remaining]]
                            : [],
                      ),
                    ),
                  );
                }}
              >
                <X size={12} aria-hidden />
              </Button>
            </span>
          )),
        )}
      </div>
    </>
  );
}
export function SessionsPage() {
  const { organization } = useWorkspace();
  const pagination = usePagination("started_at", sessionSortKeys);
  const [filters, setFilters] = useState<Record<string, string | string[]>>({});
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [searchCursors, setSearchCursors] = useState<(string | null)[]>([null]);
  const columns = useMemo(sessionColumns, []);
  const list = useQuery({
    queryKey: [
      organization.id,
      "sessions",
      filters,
      pagination.cursor,
      pagination.sort,
      pagination.direction,
    ],
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET("/api/v1/sessions", {
          params: {
            query: {
              filters: defined(searchFiltersSchema.parse(filters)),
              cursor: pagination.cursor,
              sort: pagination.sort,
              order: pagination.direction,
              limit: 50,
              format: "json",
            },
          },
          signal,
        }),
      ),
    enabled: submitted === "",
  });
  const search = useQuery({
    queryKey: [
      organization.id,
      "search",
      submitted,
      filters,
      searchCursors.at(-1),
    ],
    queryFn: async ({ signal }) =>
      unwrap(
        await api.POST("/api/v1/search", {
          body: {
            query: submitted,
            filters: defined(searchFiltersSchema.parse(filters)),
            cursor: searchCursors.at(-1) ?? null,
            context: 1,
            limit: 5,
          },
          signal,
        }),
      ),
    enabled: submitted !== "",
  });
  const changeFilters = (next: Record<string, string | string[]>) => {
    setFilters(next);
    pagination.reset();
    setSearchCursors([null]);
  };
  const result = search.data ? formatSearch(search.data) : null;
  return (
    <>
      <PageHeading
        title={copy.workspace.sessions.title}
        description={copy.workspace.sessions.description}
      />
      <form
        className="workspace-search"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(query.trim());
          setSearchCursors([null]);
        }}
      >
        <div>
          <Search size={18} aria-hidden />
          <input
            aria-label={copy.workspace.common.search}
            placeholder={copy.workspace.common.searchPlaceholder}
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        </div>
        <Button type="submit">{copy.workspace.sessions.search}</Button>
        {submitted && (
          <Button
            variant="secondary"
            onClick={() => {
              setQuery("");
              setSubmitted("");
            }}
          >
            {copy.workspace.sessions.showList}
          </Button>
        )}
      </form>
      <FilterChips filters={filters} onChange={changeFilters} />
      {submitted ? (
        <>
          {search.isPending && <LoadingState />}
          {search.error && (
            <RequestError
              error={search.error}
              retry={() => {
                void search.refetch();
              }}
            />
          )}
          {result && (
            <>
              <div className="workspace-page-actions">
                <CopyButton
                  value={result.text}
                  label={copy.workspace.common.copy}
                />
              </div>
              {result.structuredContent.blocks.length === 0 && (
                <EmptyState title={copy.workspace.sessions.noResults} />
              )}
              {result.structuredContent.blocks.map((block, index) => (
                <article
                  className="search-block"
                  key={`${block.session_id}-${String(index)}`}
                >
                  <header className="search-block-header">
                    <h2>
                      <a href={`/s/${block.session_id}`}>
                        {block.title ?? copy.workspace.sessions.untitled}
                      </a>
                    </h2>
                    <div>
                      <span>{harnessLabel(block.harness)}</span>
                      <span>{block.model}</span>
                      <span>{block.repo_name}</span>
                      <span>{block.branch}</span>
                      <span>{block.user_email}</span>
                      <time dateTime={block.started_at}>
                        {dateTime(block.started_at)}
                      </time>
                    </div>
                  </header>
                  <ShortenedFields fields={block.truncated_fields} />
                  {block.messages.map((message) => (
                    <div
                      className={
                        message.hit ? "search-message hit" : "search-message"
                      }
                      key={message.seq}
                    >
                      <div className="search-message-meta">
                        <a
                          href={`/s/${block.session_id}#${String(message.seq)}`}
                        >
                          {message.seq}
                        </a>
                        <StatusBadge value={message.role} />
                        <StatusBadge value={message.kind} />
                        {message.tool_name && <span>{message.tool_name}</span>}
                        {message.hit && (
                          <span>{copy.workspace.sessions.hit}</span>
                        )}
                        {message.truncated && (
                          <span>
                            {copy.workspace.sessions.truncatedMessage}
                          </span>
                        )}
                      </div>
                      <ShortenedFields fields={message.truncated_fields} />
                      <pre>{message.content}</pre>
                    </div>
                  ))}
                </article>
              ))}
              {result.structuredContent.truncated_response && (
                <p className="form-success">
                  {copy.workspace.sessions.truncated}
                </p>
              )}
              <div className="table-pagination">
                <Button
                  variant="secondary"
                  disabled={searchCursors.length === 1}
                  onClick={() => {
                    setSearchCursors((prior) => prior.slice(0, -1));
                  }}
                >
                  {copy.workspace.common.previous}
                </Button>
                <Button
                  variant="secondary"
                  disabled={!result.structuredContent.cursor}
                  onClick={() => {
                    const cursor = result.structuredContent.cursor;
                    if (cursor) setSearchCursors((prior) => [...prior, cursor]);
                  }}
                >
                  {copy.workspace.common.next}
                </Button>
              </div>
            </>
          )}
        </>
      ) : (
        <>
          {list.error && (
            <RequestError
              error={list.error}
              retry={() => {
                void list.refetch();
              }}
            />
          )}
          {!list.error && (
            <DataTable
              data={list.data?.items ?? []}
              columns={columns}
              sorting={pagination.sorting}
              onSortingChange={pagination.onSortingChange}
              loading={list.isPending}
              nextCursor={list.data?.cursor ?? null}
              pageIndex={pagination.pageIndex}
              onNext={() => {
                pagination.next(list.data?.cursor ?? null);
              }}
              onPrevious={pagination.previous}
              label={copy.workspace.sessions.list}
              csvName={copy.workspace.sessions.csvName}
              fetchExportPage={async (cursor, signal) =>
                unwrap(
                  await api.GET("/api/v1/sessions", {
                    params: {
                      query: {
                        filters: defined(searchFiltersSchema.parse(filters)),
                        cursor,
                        sort: pagination.sort,
                        order: pagination.direction,
                        limit: 100,
                        format: "json",
                      },
                    },
                    signal,
                  }),
                )
              }
            />
          )}
        </>
      )}
    </>
  );
}
