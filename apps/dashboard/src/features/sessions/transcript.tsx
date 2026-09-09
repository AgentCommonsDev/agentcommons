import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRight, ExternalLink } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  formatMessage,
  messageBranches,
  spawnPlacements,
} from "@agentcommons/core/format";
import type { ContentCursor, GetOutput } from "@agentcommons/core/schemas/get";
import { copy } from "../../copy";
import { api, unwrap } from "../../lib/api/client";
import {
  dateTime,
  harnessLabel,
  number,
  relativeTime,
  truncate,
} from "../../lib/display";
import { paths } from "../../lib/routes";
import type { Message, TreeNode } from "../../lib/types";
import { cn } from "../../lib/utils";
import { useWorkspace } from "../../components/app/workspace";
import { CodeBlock, Markdown } from "../../components/app/markdown";
import {
  CopyButton,
  LoadingState,
  RequestError,
  StatusBadge,
} from "../../components/app/states";
import { Button } from "../../components/ui/button";
import { Alert, EmptyState } from "../../components/ui/feedback";

const labels = copy.sessions.detail.transcript;
const runLabels = copy.sessions.detail.subagents;
const seqLabel = (seq: number) => `#${String(seq)}`;
/** A deep link into a nested run: `?child=<sessionId>#<seq>` on the root session's page. */
export interface RunFocus {
  sessionId: string;
  seq: number | null;
}

/** Bounded pages of one session; the key prefix matches the live stream's invalidation. */
export function useTranscript(
  sessionId: string,
  from: number,
  options: { polling: boolean; enabled?: boolean } = { polling: false },
) {
  const { organization } = useWorkspace();
  return useInfiniteQuery({
    queryKey: [organization.id, "session", sessionId, "transcript", from],
    initialPageParam: null as ContentCursor | null,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET("/api/v1/sessions/{id}", {
          params: {
            path: { id: sessionId },
            query: { from, cursor: pageParam },
          },
          signal,
        }),
      ),
    getNextPageParam: (last) => last.next,
    refetchInterval: (query) =>
      options.polling && query.state.data?.pages[0]?.header.status === "ACTIVE"
        ? 5000
        : false,
    enabled: options.enabled ?? true,
  });
}
/** A message split across pages by a byte cursor reads as one message again. */
export function transcriptMessages(pages: readonly GetOutput[]): Message[] {
  const merged: Message[] = [];
  for (const page of pages)
    for (const message of page.messages) {
      const last = merged.at(-1);
      if (last && last.message_id === message.message_id)
        merged[merged.length - 1] = {
          ...last,
          content: last.content + message.content,
          content_cursor: message.content_cursor,
        };
      else merged.push(message);
    }
  return merged;
}
/** TOOL_USE content is the block text, a newline, then the JSON input. */
function toolInput(content: string): { text: string; input: unknown } {
  const index = content.indexOf("\n");
  const text = index === -1 ? content : content.slice(0, index);
  const raw = index === -1 ? "" : content.slice(index + 1);
  if (!raw) return { text, input: undefined };
  try {
    return { text, input: JSON.parse(raw) };
  } catch {
    return { text, input: raw };
  }
}
function inputPreview(input: unknown): string {
  if (input === undefined || input === null) return "";
  if (typeof input !== "object" || Array.isArray(input))
    return truncate(
      typeof input === "string" ? input : JSON.stringify(input),
      120,
    );
  const parts = Object.entries(input).map(
    ([key, value]) =>
      `${key}: ${truncate(typeof value === "string" ? value : JSON.stringify(value), 60)}`,
  );
  return truncate(parts.join(" · "), 140);
}
function Collapsible({
  open: forcedOpen,
  summary,
  children,
  tone = "default",
}: {
  open: boolean;
  summary: ReactNode;
  children: ReactNode;
  tone?: "default" | "muted";
}) {
  const [open, setOpen] = useState(forcedOpen);
  useEffect(() => {
    setOpen(forcedOpen);
  }, [forcedOpen]);
  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border border-line-soft",
        tone === "muted" ? "bg-bg" : "bg-raised/60",
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen((prior) => !prior);
        }}
        className="flex w-full min-w-0 cursor-pointer items-center gap-2 px-2.5 py-1.5 text-left text-[13px] hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
      >
        <ChevronRight
          size={14}
          aria-hidden
          className={cn(
            "shrink-0 text-muted transition-transform",
            open && "rotate-90",
          )}
        />
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
          {summary}
        </span>
      </button>
      {open && (
        <div className="border-t border-line-soft px-3 py-2">{children}</div>
      )}
    </div>
  );
}
function Output({ content }: { content: string }) {
  return (
    <pre className="m-0 max-h-80 overflow-auto rounded-md bg-bg px-3 py-2 font-mono text-[12.5px] leading-relaxed break-words whitespace-pre-wrap">
      {content || labels.empty_content}
    </pre>
  );
}
function ToolResult({ message, open }: { message: Message; open: boolean }) {
  return (
    <Collapsible
      open={open}
      tone="muted"
      summary={
        <>
          <span className="font-medium">{labels.toolResult}</span>
          {message.tool_name && (
            <span className="font-mono text-xs text-muted">
              {message.tool_name}
            </span>
          )}
          <span className="truncate text-xs text-muted">
            {truncate(message.content.replace(/\s+/g, " "), 100)}
          </span>
        </>
      }
    >
      <Output content={message.content} />
    </Collapsible>
  );
}
function Body({
  message,
  results,
  expandThinking,
  expandTools,
  nested,
  selectedSeq,
}: {
  message: Message;
  results: Message[];
  expandThinking: boolean;
  expandTools: boolean;
  nested: boolean;
  selectedSeq: number | null;
}) {
  switch (message.kind) {
    case "THINKING":
      return (
        <Collapsible
          open={expandThinking}
          tone="muted"
          summary={
            <>
              <span className="font-medium text-muted">{labels.thinking}</span>
              <span className="truncate text-xs text-subtle">
                {truncate(message.content.replace(/\s+/g, " "), 100)}
              </span>
            </>
          }
        >
          <Markdown content={message.content} className="text-muted" />
        </Collapsible>
      );
    case "TOOL_USE": {
      const { text, input } = toolInput(message.content);
      return (
        <Collapsible
          open={expandTools}
          summary={
            <>
              <span className="font-medium">{labels.toolCall}</span>
              <span className="font-mono text-xs text-accent">
                {message.tool_name}
              </span>
              <span className="truncate font-mono text-xs text-muted">
                {inputPreview(input)}
              </span>
              {results.length > 0 && (
                <span className="text-xs text-subtle">
                  {number(results.length)}{" "}
                  {results.length === 1
                    ? labels.toolResultOne
                    : labels.toolResults}
                </span>
              )}
            </>
          }
        >
          <div className="flex flex-col gap-2">
            {text && <Markdown content={text} />}
            {input !== undefined && (
              <div>
                <p className="mb-1 text-[11px] font-medium tracking-wide text-subtle uppercase">
                  {labels.input}
                </p>
                <CodeBlock
                  content={
                    typeof input === "string"
                      ? input
                      : JSON.stringify(input, null, 2)
                  }
                  language={typeof input === "string" ? "text" : "json"}
                  className="my-0"
                />
              </div>
            )}
            {results.map((result) => (
              <div
                key={result.message_id}
                id={nested ? undefined : String(result.seq)}
                data-testid={
                  nested ? undefined : `session-message-${String(result.seq)}`
                }
                className={cn(
                  selectedSeq === result.seq &&
                    "rounded-md ring-2 ring-accent ring-offset-2 ring-offset-surface",
                )}
              >
                <p className="mb-1 text-[11px] font-medium tracking-wide text-subtle uppercase">
                  {labels.output}
                  <span className="ml-2 font-mono normal-case tracking-normal">
                    {seqLabel(result.seq)}
                  </span>
                </p>
                <Output content={result.content} />
              </div>
            ))}
          </div>
        </Collapsible>
      );
    }
    case "TOOL_RESULT":
      return <ToolResult message={message} open={expandTools} />;
    case "META":
      return (
        <Collapsible
          open={false}
          tone="muted"
          summary={
            <>
              <span className="font-medium text-muted">{labels.meta}</span>
              <span className="truncate text-xs text-subtle">
                {truncate(message.content.replace(/\s+/g, " "), 100)}
              </span>
            </>
          }
        >
          <Output content={message.content} />
        </Collapsible>
      );
    default:
      return <Markdown content={message.content} />;
  }
}
function MessageItem({
  message,
  results,
  runs,
  nodes,
  focus,
  sessionId,
  selected,
  expandThinking,
  expandTools,
  nested,
}: {
  message: Message;
  results: Message[];
  /** Child sessions this tool call spawned; each renders as a collapsed run under it. */
  runs: readonly TreeNode[];
  nodes: readonly TreeNode[];
  focus: RunFocus | null;
  sessionId: string;
  selected: number | null;
  expandThinking: boolean;
  expandTools: boolean;
  nested: boolean;
}) {
  const element = useRef<HTMLElement>(null);
  const resultSelected = results.some((result) => result.seq === selected);
  const isSelected = selected === message.seq || resultSelected;
  useEffect(() => {
    if (isSelected) element.current?.scrollIntoView({ block: "center" });
  }, [isSelected]);
  const tokens =
    message.input_tokens !== null || message.output_tokens !== null
      ? `${labels.tokens}: ${number(message.input_tokens)} ${copy.sessions.detail.tokensIn}${copy.app.common.separator}${number(message.output_tokens)} ${copy.sessions.detail.tokensOut}`
      : null;
  return (
    <article
      ref={element}
      id={nested ? undefined : String(message.seq)}
      data-testid={
        nested ? undefined : `session-message-${String(message.seq)}`
      }
      className={cn(
        "flex flex-col gap-2 rounded-lg border px-3 py-2.5 sm:px-4",
        isSelected
          ? "border-accent bg-accent-bg/30"
          : "border-line-soft bg-surface",
        message.role === "USER" && !isSelected && "border-line",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
        <Link
          to="/app/sessions/$id"
          params={{ id: sessionId }}
          hash={String(message.seq)}
          className="font-mono hover:text-accent"
          aria-label={`${labels.message} ${String(message.seq)}`}
        >
          {seqLabel(message.seq)}
        </Link>
        <StatusBadge value={message.role} />
        {message.kind !== "TEXT" &&
          message.kind !== "TOOL_USE" &&
          message.kind !== message.role && <StatusBadge value={message.kind} />}
        {message.timestamp && (
          <time dateTime={message.timestamp}>
            {dateTime(message.timestamp)}
          </time>
        )}
        {tokens && <span className="hidden sm:inline">{tokens}</span>}
        <span className="ml-auto flex items-center">
          <CopyButton
            value={formatMessage(message)}
            label={labels.copyMessage}
          />
          <CopyButton
            value={`${window.location.origin}${paths.session(sessionId, message.seq)}`}
            label={labels.copyLink}
          />
        </span>
      </div>
      <Body
        message={message}
        results={results}
        expandThinking={expandThinking}
        expandTools={expandTools || resultSelected}
        nested={nested}
        selectedSeq={selected}
      />
      {runs.length > 0 && (
        <RunList
          runs={runs}
          nodes={nodes}
          focus={focus}
          expandThinking={expandThinking}
          expandTools={expandTools}
          placed
        />
      )}
      {message.content_cursor && (
        <p className="text-xs text-muted">{labels.continues}</p>
      )}
    </article>
  );
}
function matches(
  branch: { message: Message; results: Message[] },
  find: string,
) {
  const needle = find.toLowerCase();
  return (
    branch.message.content.toLowerCase().includes(needle) ||
    branch.results.some((result) =>
      result.content.toLowerCase().includes(needle),
    )
  );
}
/** Source-ordered messages with results, and the child runs a call spawned, nested under
 * their unambiguous tool call. `nodes` is the session tree; runs not attached to a loaded
 * call stay in the caller's Subagent runs list. */
export function MessageList({
  messages,
  sessionId,
  selected,
  find,
  expandThinking,
  expandTools,
  nested = false,
  nodes = [],
  focus = null,
}: {
  messages: Message[];
  sessionId: string;
  selected: number | null;
  find: string;
  expandThinking: boolean;
  expandTools: boolean;
  nested?: boolean;
  nodes?: readonly TreeNode[];
  focus?: RunFocus | null;
}) {
  const branches = messageBranches(messages);
  const { placed } = spawnPlacements(messages, nodes, sessionId);
  const shown = find.trim()
    ? branches.filter((branch) => matches(branch, find.trim()))
    : branches;
  if (messages.length === 0)
    return (
      <EmptyState compact title={labels.empty} description={labels.emptyHint} />
    );
  if (shown.length === 0)
    return <EmptyState compact title={labels.noFindMatch} />;
  let previousModel: string | null = null;
  const items: ReactNode[] = [];
  for (const branch of shown) {
    const model = branch.message.model;
    if (model && model !== previousModel) {
      items.push(
        <div
          key={`model-${branch.message.message_id}`}
          className="flex items-center gap-2 text-[11px] text-muted"
          role="note"
        >
          <span className="h-px flex-1 bg-line-soft" />
          <span>
            {labels.modelChanged}
            {copy.app.common.separator}
            <span className="font-mono text-fg">{model}</span>
          </span>
          <span className="h-px flex-1 bg-line-soft" />
        </div>,
      );
      previousModel = model;
    }
    items.push(
      <MessageItem
        key={branch.message.message_id}
        message={branch.message}
        results={branch.results}
        runs={placed.get(branch.message.message_id) ?? []}
        nodes={nodes}
        focus={focus}
        sessionId={sessionId}
        selected={selected}
        expandThinking={expandThinking}
        expandTools={expandTools}
        nested={nested}
      />,
    );
  }
  return <div className="flex flex-col gap-2">{items}</div>;
}

/** A child's messages load only when someone expands it, through the same message list;
 * grandchildren nest under the child's own calls or follow its messages. A focused run
 * starts two messages above its deep-linked message and pages until that message is in. */
function RunMessages({
  node,
  nodes,
  focus,
  expandThinking,
  expandTools,
}: {
  node: TreeNode;
  nodes: readonly TreeNode[];
  focus: RunFocus | null;
  expandThinking: boolean;
  expandTools: boolean;
}) {
  const selected = focus?.sessionId === node.session_id ? focus.seq : null;
  const from = selected === null ? 0 : Math.max(0, selected - 2);
  const transcript = useTranscript(node.session_id, from);
  const messages = useMemo(
    () => (transcript.data ? transcriptMessages(transcript.data.pages) : []),
    [transcript.data],
  );
  const lastSeq = messages.at(-1)?.seq ?? -1;
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = transcript;
  useEffect(() => {
    if (selected === null || lastSeq >= selected) return;
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [selected, lastSeq, hasNextPage, isFetchingNextPage, fetchNextPage]);
  if (transcript.isPending) return <LoadingState rows={2} />;
  if (transcript.error)
    return (
      <RequestError
        error={transcript.error}
        retry={() => {
          void transcript.refetch();
        }}
      />
    );
  const { unplaced } = spawnPlacements(messages, nodes, node.session_id);
  return (
    <div className="flex flex-col gap-2">
      {from > 0 && (
        <p className="text-xs text-muted">
          {labels.startedFrom} {number(from)}
          {copy.app.common.separator}
          <Link
            to="/app/sessions/$id"
            params={{ id: node.session_id }}
            className="text-accent hover:underline"
          >
            {runLabels.openPage}
          </Link>
        </p>
      )}
      <MessageList
        messages={messages}
        sessionId={node.session_id}
        selected={selected}
        find=""
        expandThinking={expandThinking}
        expandTools={expandTools}
        nested
        nodes={nodes}
        focus={focus}
      />
      {transcript.hasNextPage && (
        <Button
          variant="secondary"
          size="sm"
          className="self-center"
          disabled={transcript.isFetchingNextPage}
          onClick={() => {
            void transcript.fetchNextPage();
          }}
        >
          {labels.loadMore}
        </Button>
      )}
      {unplaced.length > 0 && (
        <RunList
          runs={unplaced}
          nodes={nodes}
          focus={focus}
          expandThinking={expandThinking}
          expandTools={expandTools}
        />
      )}
    </div>
  );
}
function RunBlock({
  node,
  nodes,
  focus,
  expandThinking,
  expandTools,
  placed,
}: {
  node: TreeNode;
  nodes: readonly TreeNode[];
  focus: RunFocus | null;
  expandThinking: boolean;
  expandTools: boolean;
  placed: boolean;
}) {
  // A deep-linked run opens on arrival; it keeps that state if the block moves from the
  // fallback list under its call once the page holding that call loads.
  const focused = focus?.sessionId === node.session_id;
  const [open, setOpen] = useState(focused);
  const element = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (focused && focus.seq === null)
      element.current?.scrollIntoView({ block: "start" });
  }, [focused, focus]);
  return (
    <li
      ref={element}
      data-testid={`session-subagent-${node.session_id}`}
      className={cn(
        "overflow-hidden rounded-lg border bg-surface",
        focused ? "border-accent" : "border-line",
      )}
    >
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 sm:px-4">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => {
            setOpen((prior) => !prior);
          }}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <ChevronRight
            size={16}
            aria-hidden
            className={cn(
              "shrink-0 text-muted transition-transform",
              open && "rotate-90",
            )}
          />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex flex-wrap items-center gap-1.5">
              {placed && (
                <span className="text-xs font-medium text-muted">
                  {runLabels.spawned}
                </span>
              )}
              {node.parent_relation && (
                <StatusBadge value={node.parent_relation} />
              )}
              {node.agent_type && (
                <span className="font-mono text-xs text-accent">
                  {node.agent_type}
                </span>
              )}
              <span className="truncate text-sm font-medium">
                {node.title ?? copy.sessions.list.untitled}
              </span>
            </span>
            <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
              <StatusBadge value={node.status} />
              <span>{harnessLabel(node.harness)}</span>
              <span>
                {number(node.message_count)} {runLabels.messages}
              </span>
              <time
                dateTime={node.started_at}
                title={dateTime(node.started_at)}
              >
                {relativeTime(node.started_at)}
              </time>
            </span>
          </span>
        </button>
        <Button asChild variant="ghost" size="sm" className="text-muted">
          <Link to="/app/sessions/$id" params={{ id: node.session_id }}>
            <ExternalLink aria-hidden />
            <span className="sr-only sm:not-sr-only">{runLabels.openPage}</span>
          </Link>
        </Button>
      </div>
      {open && (
        <div className="flex flex-col gap-3 border-t border-line-soft bg-bg/60 p-2 sm:p-3">
          {node.gap && <Alert variant="warning">{runLabels.gap}</Alert>}
          <RunMessages
            node={node}
            nodes={nodes}
            focus={focus}
            expandThinking={expandThinking}
            expandTools={expandTools}
          />
        </div>
      )}
    </li>
  );
}
/** Child runs as collapsed blocks: under the tool call that spawned them (`placed`) or in a
 * list after the messages that could not place them. */
export function RunList({
  runs,
  nodes,
  focus,
  expandThinking,
  expandTools,
  placed = false,
}: {
  runs: readonly TreeNode[];
  nodes: readonly TreeNode[];
  focus: RunFocus | null;
  expandThinking: boolean;
  expandTools: boolean;
  placed?: boolean;
}) {
  return (
    <ul className={cn("flex flex-col gap-2", placed && "ml-4 sm:ml-6")}>
      {runs.map((node) => (
        <RunBlock
          key={node.session_id}
          node={node}
          nodes={nodes}
          focus={focus}
          expandThinking={expandThinking}
          expandTools={expandTools}
          placed={placed}
        />
      ))}
    </ul>
  );
}
