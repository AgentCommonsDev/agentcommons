import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRight, CornerDownRight, ExternalLink } from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  formatMessage,
  messageBranches,
  spawnPlacements,
} from "@agentcommons/core/format";
import {
  messageKindSchema,
  responseBytes,
} from "@agentcommons/core/schemas/common";
import type {
  ContentCursor,
  GetOutput,
  SessionHeader,
} from "@agentcommons/core/schemas/get";
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

/** The dashboard reads `get` at the REST page cap, eight times the agent budget (§7.3, §10). */
const PAGE_BYTES = responseBytes.page;
const EVERY_KIND = [...messageKindSchema.options];
/** Seq ranges are sized so one usually fits a single page, from the head page's density. */
const RANGE_TARGET_BYTES = (PAGE_BYTES * 3) / 4;
const RANGE_MESSAGES = { min: 25, max: 400 };
/** Range requests in flight at once. */
const IN_FLIGHT = 3;
/** Ranges that load without a reader's action; beyond them Load more takes over. */
const EAGER_RANGES = 16;
/** One seq range of a transcript; `cursor` continues the head page's split last message. */
interface SeqRange {
  from: number;
  to: number;
  cursor: ContentCursor | null;
}
async function readPage(
  sessionId: string,
  query: {
    from?: number;
    to?: number;
    cursor?: ContentCursor | null;
    /** False reads messages only: the header is the expensive part and the head page has it. */
    header?: boolean;
  },
  signal: AbortSignal,
  pageBytes = PAGE_BYTES,
) {
  return unwrap(
    await api.GET("/api/v1/sessions/{id}", {
      params: {
        path: { id: sessionId },
        // Every kind: the transcript shows META housekeeping as collapsed rows a reader
        // can expand, unlike an agent's default read (§7.3).
        query: { ...query, page_bytes: pageBytes, kinds: EVERY_KIND },
      },
      signal,
    }),
  );
}
/** Every page of one range, following cursors until the range is complete. */
async function readRange(
  sessionId: string,
  range: SeqRange,
  signal: AbortSignal,
): Promise<GetOutput[]> {
  const pages: GetOutput[] = [];
  let cursor = range.cursor;
  do {
    const page = await readPage(
      sessionId,
      { from: range.from, to: range.to, cursor, header: false },
      signal,
    );
    pages.push(page);
    cursor = page.next;
  } while (cursor !== null);
  return pages;
}
/**
 * The ranges after the head page that cover messages up to `total`, in strides sized by
 * the head's bytes per message. Only the last range's end moves as a live session grows,
 * so earlier ranges stay cached and just the tail is read again.
 */
function planRanges(head: GetOutput, from: number, total: number): SeqRange[] {
  const start = head.next ?? {
    seq: (head.messages.at(-1)?.seq ?? from - 1) + 1,
    offset: 0,
  };
  if (start.seq >= total) return [];
  const bytesPerMessage =
    head.messages.reduce((sum, message) => sum + message.content.length, 0) /
      Math.max(1, head.messages.length) +
    400;
  const stride = Math.min(
    RANGE_MESSAGES.max,
    Math.max(
      RANGE_MESSAGES.min,
      Math.round(RANGE_TARGET_BYTES / bytesPerMessage),
    ),
  );
  const ranges: SeqRange[] = [];
  for (let first = start.seq; first < total; first += stride)
    ranges.push({
      from: first,
      to: Math.min(first + stride - 1, total - 1),
      cursor: first === start.seq && start.offset > 0 ? start : null,
    });
  return ranges;
}
/** What a live session reports about itself: the stream's event, or a header read while the stream is down. */
interface LiveSnapshot {
  status: SessionHeader["status"];
  message_count: number;
}
/**
 * One session's transcript from `from`: the head page (the only one that computes the
 * session header), then seq ranges up to the session's message count with at most three
 * requests in flight, rendered as each lands. An active session's status and count come
 * from the live stream's own events (`snapshot`); a header-only read under the stream's
 * invalidation key is polled every 5 s only while the stream is down. Growth extends the
 * ranges; loaded ranges are never read again.
 */
export function useTranscript(
  sessionId: string,
  from: number,
  options: { polling: boolean; snapshot?: LiveSnapshot | null } = {
    polling: false,
  },
) {
  const { organization } = useWorkspace();
  const head = useQuery({
    queryKey: [organization.id, "transcript", sessionId, "head", from],
    queryFn: ({ signal }) => readPage(sessionId, { from }, signal),
    staleTime: Infinity,
  });
  const headHeader = head.data?.header ?? undefined;
  const snapshot = options.snapshot ?? null;
  const active = (snapshot?.status ?? headHeader?.status) === "ACTIVE";
  const status = useQuery({
    queryKey: [organization.id, "session", sessionId, "status"],
    queryFn: ({ signal }) =>
      readPage(sessionId, { from: 0, to: 0 }, signal, responseBytes.read),
    enabled: active && options.polling,
    refetchInterval: 5000,
  });
  const polled = status.data?.header ?? null;
  const live = options.polling ? (polled ?? snapshot) : (snapshot ?? polled);
  const header: SessionHeader | undefined =
    headHeader && live
      ? {
          ...headHeader,
          status: live.status,
          message_count: live.message_count,
        }
      : headHeader;
  const total = header?.message_count ?? 0;
  const ranges = useMemo(
    () => (head.data ? planRanges(head.data, from, total) : []),
    [head.data, from, total],
  );
  const [cap, setCap] = useState(EAGER_RANGES);
  const fetchNextPage = useCallback(() => {
    setCap((prior) => prior + IN_FLIGHT);
  }, []);
  // Ranges become eligible in order as earlier ones complete, so at most IN_FLIGHT run.
  const [done, setDone] = useState(0);
  const results = useQueries({
    queries: ranges.map((range, index) => ({
      queryKey: [
        organization.id,
        "transcript",
        sessionId,
        "range",
        range.from,
        range.to,
        range.cursor?.offset ?? 0,
      ],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        readRange(sessionId, range, signal),
      enabled: index < Math.min(cap, done + IN_FLIGHT),
      staleTime: Infinity,
      placeholderData: keepPreviousData,
    })),
  });
  const settled = results.filter(
    (result) => result.isSuccess && !result.isPlaceholderData,
  ).length;
  useEffect(() => {
    setDone(settled);
  }, [settled]);
  const messages = useMemo(() => {
    if (!head.data) return [];
    const pages = [head.data];
    for (const result of results) {
      if (!result.data) break;
      pages.push(...result.data);
    }
    return transcriptMessages(pages);
  }, [head.data, results]);
  const failed = results.filter((result) => result.error !== null);
  return {
    header,
    messages,
    isPending: head.isPending,
    /** The head page failed: no header, nothing to show. */
    error: head.error,
    refetch: () => {
      void head.refetch();
    },
    /** A later range failed: the header and the messages before it stay on the page. */
    rangeError: failed[0]?.error ?? null,
    retryRanges: () => {
      for (const result of failed) void result.refetch();
    },
    hasNextPage: ranges.length > cap,
    isFetchingNextPage: results.some((result) => result.isFetching),
    fetchNextPage,
  };
}
/**
 * A message longer than its slice arrives bounded with a `content_cursor`; the rest is
 * read on demand, slice by slice, with `from` and `to` at its seq (§7.3). Until then the
 * message renders as received.
 */
function useWholeMessage(sessionId: string, message: Message) {
  const [rest, setRest] = useState<{ id: string; content: string } | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const whole =
    rest?.id === message.message_id
      ? {
          ...message,
          content: message.content + rest.content,
          content_cursor: null,
        }
      : message;
  const loadRest = useCallback(() => {
    if (!message.content_cursor) return;
    setLoading(true);
    setError(null);
    void (async () => {
      const controller = new AbortController();
      let cursor: ContentCursor | null = message.content_cursor;
      const parts: string[] = [];
      try {
        while (cursor !== null) {
          const page: GetOutput = await readPage(
            sessionId,
            {
              from: message.seq,
              to: message.seq,
              cursor,
              header: false,
            },
            controller.signal,
          );
          for (const slice of page.messages) parts.push(slice.content);
          cursor = page.next;
        }
        setRest({ id: message.message_id, content: parts.join("") });
      } catch (failure) {
        setError(failure);
      } finally {
        setLoading(false);
      }
    })();
  }, [sessionId, message.content_cursor, message.message_id, message.seq]);
  return { message: whole, loading, error, loadRest };
}
/** The notice under a bounded message: what it is, and the button that reads the rest. */
function RestNotice({
  message,
  loading,
  error,
  loadRest,
}: {
  message: Message;
  loading: boolean;
  error: unknown;
  loadRest: () => void;
}) {
  if (!message.content_cursor) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
      <span>{labels.longMessage}</span>
      <Button
        variant="secondary"
        size="sm"
        disabled={loading}
        onClick={loadRest}
      >
        {loading ? labels.loadingRest : labels.showRest}
      </Button>
      {error !== null && (
        <RequestError
          title={copy.sessions.detail.errors.messages}
          error={error}
          className="basis-full"
        />
      )}
    </div>
  );
}
/** A message split across pages by a byte cursor reads as one message again. */
function transcriptMessages(pages: readonly GetOutput[]): Message[] {
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
/** The first line of a tool result, so a collapsed call still says what came back. */
function gist(content: string): string {
  return truncate(content.trim().split("\n", 1)[0]?.trim() ?? "", 120);
}
/**
 * A tool call's input as labelled fields: most inputs are a flat object (a path, a command,
 * a pattern), which reads better as name and value than as JSON. Multi-line or long values
 * get their own block; nested inputs fall back to formatted JSON.
 */
function ToolInputView({ input }: { input: unknown }) {
  if (typeof input === "string")
    return <CodeBlock content={input} language="text" className="my-0" />;
  const entries =
    input !== null && typeof input === "object" && !Array.isArray(input)
      ? Object.entries(input)
      : null;
  if (
    !entries ||
    entries.some(([, value]) => value !== null && typeof value === "object")
  )
    return (
      <CodeBlock
        content={JSON.stringify(input, null, 2)}
        language="json"
        className="my-0"
      />
    );
  return (
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[12.5px]">
      {entries.map(([key, value]) => {
        const text = typeof value === "string" ? value : JSON.stringify(value);
        return (
          <Fragment key={key}>
            <dt className="pt-0.5 font-mono text-xs text-subtle">{key}</dt>
            <dd className="m-0 min-w-0">
              {text.includes("\n") || text.length > 160 ? (
                <Output content={text} />
              ) : (
                <code className="font-mono break-words">{text}</code>
              )}
            </dd>
          </Fragment>
        );
      })}
    </dl>
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
/** One tool result inside its call: the output, its seq, and the rest of it on demand. */
function ResultBlock({
  sessionId,
  result,
  nested,
  selected,
}: {
  sessionId: string;
  result: Message;
  nested: boolean;
  selected: boolean;
}) {
  const whole = useWholeMessage(sessionId, result);
  return (
    <div
      id={nested ? undefined : String(result.seq)}
      data-testid={nested ? undefined : `session-message-${String(result.seq)}`}
      className={cn(
        "flex flex-col gap-1",
        selected &&
          "rounded-md ring-2 ring-accent ring-offset-2 ring-offset-surface",
      )}
    >
      <p className="text-[11px] font-medium tracking-wide text-subtle uppercase">
        {labels.output}
        <span className="ml-2 font-mono normal-case tracking-normal">
          {seqLabel(result.seq)}
        </span>
      </p>
      <Output content={whole.message.content} />
      <RestNotice {...whole} />
    </div>
  );
}
function Body({
  message,
  results,
  expandThinking,
  expandTools,
  nested,
  selectedSeq,
  sessionId,
}: {
  message: Message;
  results: Message[];
  expandThinking: boolean;
  expandTools: boolean;
  nested: boolean;
  selectedSeq: number | null;
  sessionId: string;
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
              <span className="text-muted">{labels.toolCall}</span>
              <span className="font-mono text-xs font-medium text-accent">
                {message.tool_name}
              </span>
              <span className="truncate font-mono text-xs text-muted">
                {inputPreview(input)}
              </span>
              {results.length === 1 && results[0] && (
                <span className="flex basis-full items-center gap-1.5 text-xs text-muted">
                  <CornerDownRight
                    size={12}
                    aria-hidden
                    className="shrink-0 text-subtle"
                  />
                  <span className="truncate font-mono">
                    {gist(results[0].content) || labels.empty_content}
                  </span>
                </span>
              )}
              {results.length > 1 && (
                <span className="text-xs text-subtle">
                  {number(results.length)} {labels.toolResults}
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
                <ToolInputView input={input} />
              </div>
            )}
            {results.map((result) => (
              <ResultBlock
                key={result.message_id}
                sessionId={sessionId}
                result={result}
                nested={nested}
                selected={selectedSeq === result.seq}
              />
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
  message: received,
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
  const whole = useWholeMessage(sessionId, received);
  const { message } = whole;
  const resultSelected = results.some((result) => result.seq === selected);
  const isSelected = selected === message.seq || resultSelected;
  useEffect(() => {
    if (isSelected) element.current?.scrollIntoView({ block: "center" });
  }, [isSelected]);
  // Token counts and the record identity show on hover (§10), keeping the row to who,
  // when and where; the body block names the kind (thinking, tool call, metadata).
  const details = [
    ...(message.input_tokens !== null || message.output_tokens !== null
      ? [
          `${labels.tokens}: ${number(message.input_tokens)} ${copy.sessions.detail.tokensIn}${copy.app.common.separator}${number(message.output_tokens)} ${copy.sessions.detail.tokensOut}`,
        ]
      : []),
    ...(message.raw_record_id
      ? [`${copy.app.fields.raw_record_id}: ${message.raw_record_id}`]
      : []),
  ].join("\n");
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
        // A prompt is where a turn starts: it stands out from the agent's work below it.
        message.role === "USER" && !isSelected && "border-line bg-raised",
      )}
    >
      <div
        className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted"
        title={details || undefined}
      >
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
        {message.timestamp && (
          <time dateTime={message.timestamp}>
            {dateTime(message.timestamp)}
          </time>
        )}
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
        sessionId={sessionId}
      />
      <RestNotice {...whole} />
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
  const { messages } = transcript;
  const lastSeq = messages.at(-1)?.seq ?? -1;
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = transcript;
  useEffect(() => {
    if (selected === null || lastSeq >= selected) return;
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [selected, lastSeq, hasNextPage, isFetchingNextPage, fetchNextPage]);
  if (transcript.isPending) return <LoadingState rows={2} />;
  if (transcript.error)
    return (
      <RequestError
        title={copy.sessions.detail.errors.messages}
        error={transcript.error}
        retry={transcript.refetch}
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
      {transcript.rangeError !== null && (
        <RequestError
          title={copy.sessions.detail.errors.messages}
          error={transcript.rangeError}
          retry={transcript.retryRanges}
        />
      )}
      {transcript.hasNextPage && (
        <LoadMore
          size="sm"
          fetching={isFetchingNextPage}
          onLoad={fetchNextPage}
        >
          {labels.loadMore}
        </LoadMore>
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
/**
 * The next transcript page loads when this control scrolls into view, so a reader reaches
 * the end of a long session by scrolling; the button stays for keyboards and screen readers.
 */
export function LoadMore({
  fetching,
  onLoad,
  size = "md",
  children,
}: {
  fetching: boolean;
  onLoad: () => void;
  size?: "sm" | "md" | undefined;
  children: ReactNode;
}) {
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || fetching) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoad();
      },
      { rootMargin: "240px 0px" },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [fetching, onLoad]);
  return (
    <div ref={sentinel} className="flex justify-center">
      <Button
        variant="secondary"
        size={size}
        disabled={fetching}
        onClick={onLoad}
      >
        {children}
      </Button>
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
        placed && "border-l-2 border-l-accent",
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
                {node.title ?? copy.app.common.untitledSession}
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
