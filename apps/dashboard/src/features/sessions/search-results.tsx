import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatSearch } from "@agentcommons/core/format";
import { copy } from "../../copy";
import { api, unwrap } from "../../lib/api/client";
import {
  dateTime,
  harnessLabel,
  number,
  relativeTime,
} from "../../lib/display";
import { cn } from "../../lib/utils";
import { useWorkspace } from "../../components/app/workspace";
import {
  CopyButton,
  LoadingState,
  RequestError,
  StatusBadge,
} from "../../components/app/states";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Alert, EmptyState } from "../../components/ui/feedback";
import type { ApiFilters } from "./search-state";

const seqLabel = (seq: number) => `#${String(seq)}`;
const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Wrap query words in <mark>; the server already ranked, this only shows why a row matched. */
function highlight(content: string, query: string): ReactNode {
  const words = [
    ...new Set(query.split(/\s+/).filter((word) => word.length >= 2)),
  ];
  if (words.length === 0) return content;
  const pattern = new RegExp(`(${words.map(escapeRegExp).join("|")})`, "gi");
  const parts = content.split(pattern);
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <mark key={index} className="rounded-sm bg-warning-bg px-0.5 text-fg">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}
export function MessageResults({
  query,
  filters,
}: {
  query: string;
  filters: ApiFilters;
}) {
  const { organization } = useWorkspace();
  const labels = copy.sessions.results;
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors.at(-1) ?? null;
  // A new query or filter set starts from the first page again.
  const key = JSON.stringify([query, filters]);
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setCursors([null]);
  }
  const search = useQuery({
    queryKey: [organization.id, "search", query, filters, cursor],
    queryFn: async ({ signal }) =>
      unwrap(
        await api.POST("/api/v1/search", {
          body: { query, filters, cursor, context: 1, limit: 10 },
          signal,
        }),
      ),
  });
  const formatted = useMemo(
    () => (search.data ? formatSearch(search.data) : null),
    [search.data],
  );
  if (search.isPending) return <LoadingState rows={4} />;
  if (search.error)
    return (
      <RequestError
        error={search.error}
        retry={() => {
          void search.refetch();
        }}
      />
    );
  const { blocks, cursor: next, truncated_response } = search.data;
  const sessionCount = new Set(blocks.map((block) => block.session_id)).size;
  if (blocks.length === 0)
    return <EmptyState title={labels.empty} description={labels.emptyHint} />;
  return (
    <div className="flex flex-col gap-3" aria-label={labels.label}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
        <span>
          {number(sessionCount)}{" "}
          {sessionCount === 1 ? labels.sessionCountOne : labels.sessionCount}
        </span>
        {formatted && (
          <CopyButton
            value={formatted.text}
            label={labels.copy}
            showLabel
            size="sm"
          />
        )}
      </div>
      {blocks.map((block, index) => {
        // A hit inside a subagent, fork or spawned run opens its root session with
        // the run expanded; the child never has a page of its own in the list.
        const nested = block.root_session_id !== block.session_id;
        const search = nested ? { child: block.session_id } : {};
        return (
          <article
            key={`${block.session_id}-${String(index)}`}
            className="overflow-hidden rounded-lg border border-line bg-surface"
          >
            <header className="flex flex-col gap-1 border-b border-line-soft px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  to="/app/sessions/$id"
                  params={{ id: block.root_session_id }}
                  search={search}
                  className="text-[15px] font-semibold text-fg hover:underline"
                >
                  {block.title ?? copy.sessions.list.untitled}
                </Link>
                {block.parent_relation && (
                  <StatusBadge value={block.parent_relation} />
                )}
                {block.agent_type && (
                  <Badge variant="outline" className="font-mono">
                    {block.agent_type}
                  </Badge>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                <span>{harnessLabel(block.harness)}</span>
                {block.model && (
                  <span className="font-mono">{block.model}</span>
                )}
                {block.repo_name && (
                  <span className="min-w-0 max-w-full truncate">
                    {block.repo_name}
                    {block.branch && (
                      <span className="font-mono">
                        {copy.app.common.separator}
                        {block.branch}
                      </span>
                    )}
                  </span>
                )}
                <span>{block.user_email}</span>
                <time
                  dateTime={block.started_at}
                  title={dateTime(block.started_at)}
                >
                  {relativeTime(block.started_at)}
                </time>
              </div>
            </header>
            <ol className="divide-y divide-line-soft">
              {block.messages.map((message) => (
                <li
                  key={message.seq}
                  className={cn(
                    "flex flex-col gap-1.5 px-4 py-3",
                    message.hit
                      ? "border-l-2 border-l-accent"
                      : "border-l-2 border-l-transparent text-muted",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <Link
                      to="/app/sessions/$id"
                      params={{ id: block.root_session_id }}
                      search={search}
                      hash={String(message.seq)}
                      className="font-mono text-accent hover:underline"
                      aria-label={`${labels.open} ${String(message.seq)}`}
                    >
                      {seqLabel(message.seq)}
                    </Link>
                    <StatusBadge value={message.role} />
                    {message.kind !== "TEXT" &&
                      message.kind !== message.role && (
                        <StatusBadge value={message.kind} />
                      )}
                    {message.tool_name && (
                      <span className="font-mono text-fg">
                        {message.tool_name}
                      </span>
                    )}
                    {message.hit ? (
                      <Badge variant="accent">{labels.hit}</Badge>
                    ) : (
                      <Badge variant="outline">{labels.context}</Badge>
                    )}
                    {message.truncated && <Badge>{labels.truncated}</Badge>}
                  </div>
                  <p
                    className={cn(
                      "max-h-56 overflow-y-auto text-sm leading-relaxed break-words whitespace-pre-wrap",
                      !message.hit && "max-h-24",
                    )}
                  >
                    {message.hit
                      ? highlight(message.content.trimStart(), query)
                      : message.content.trimStart()}
                  </p>
                </li>
              ))}
            </ol>
          </article>
        );
      })}
      {truncated_response && (
        <Alert variant="warning">{labels.truncatedResponse}</Alert>
      )}
      {(cursors.length > 1 || next) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={cursors.length === 1}
            onClick={() => {
              setCursors((prior) => prior.slice(0, -1));
            }}
          >
            <ChevronLeft aria-hidden />
            {labels.previous}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!next}
            onClick={() => {
              if (next) setCursors((prior) => [...prior, next]);
            }}
          >
            {labels.next}
            <ChevronRight aria-hidden />
          </Button>
        </div>
      )}
    </div>
  );
}
