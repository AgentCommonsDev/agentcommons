import { useEffect, useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { copy } from "../copy";
import { api, unwrap } from "../lib/api/client";
import { number } from "../lib/display";
import { useSessionStream, type SessionEvent } from "../lib/use-session-stream";
import { useWorkspace } from "../components/app/workspace";
import {
  LoadingState,
  RequestError,
  StatusBadge,
} from "../components/app/states";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Label, Switch } from "../components/ui/field";
import { Alert, Spinner } from "../components/ui/feedback";
import { Input } from "../components/ui/input";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../components/ui/tabs";
import { ModerationMenu } from "../features/admin/moderation";
import { FilesTab } from "../features/sessions/files";
import { RawTab } from "../features/sessions/raw";
import { ReuseCard } from "../features/sessions/reuse";
import {
  SessionHeaderView,
  type StreamState,
} from "../features/sessions/session-header";
import { SubagentRuns } from "../features/sessions/subagents";
import {
  LoadMore,
  MessageList,
  useTranscript,
  type RunFocus,
} from "../features/sessions/transcript";

const labels = copy.sessions.detail;
type Tab = "transcript" | "files" | "raw";
/** One session page: header, reuse, transcript with inline subagent runs, files and raw records. */
export function SessionPage({
  id,
  seq,
  child,
}: {
  id: string;
  /** The message the URL hash names, parsed by the route. */
  seq: number | null;
  child?: string;
}) {
  // Owner and admin memberships moderate from here; the admin routes enforce the same.
  const { organization, admin } = useWorkspace();
  // With `child`, the hash names a message inside that nested run, not this transcript.
  const selected = child === undefined ? seq : null;
  const focus: RunFocus | null =
    child === undefined ? null : { sessionId: child, seq };
  // Two messages of context above a deep-linked message.
  const from = selected === null ? 0 : Math.max(0, selected - 2);
  const [tab, setTab] = useState<Tab>("transcript");
  // Null until the event stream reports; the transcript polls until it does.
  const [connected, setConnected] = useState<boolean | null>(null);
  // The stream's latest event: status and message count without another header read.
  const [snapshot, setSnapshot] = useState<SessionEvent | null>(null);
  // Null until the reader chooses; live sessions follow their tail unless deep-linked.
  const [follow, setFollow] = useState<boolean | null>(null);
  const [find, setFind] = useState("");
  const [expandThinking, setExpandThinking] = useState(false);
  const [expandTools, setExpandTools] = useState(false);
  const transcript = useTranscript(id, from, {
    polling: connected !== true,
    snapshot,
  });
  const { header, messages } = transcript;
  const active = header?.status === "ACTIVE";
  const latest = (header?.message_count ?? 0) - 1;
  const following = follow ?? (active && selected === null && focus === null);
  const stream: StreamState | undefined = active
    ? connected === null
      ? "connecting"
      : connected
        ? "streaming"
        : "reconnecting"
    : undefined;
  useSessionStream(organization.id, id, active, setConnected, setSnapshot);
  const tree = useQuery({
    queryKey: [organization.id, "tree", id],
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET("/api/v1/sessions/{id}/tree", {
          params: { path: { id }, query: { limit: 100, cursor: null } },
          signal,
        }),
      ),
    enabled: header !== undefined,
  });
  const lastSeq = messages.at(-1)?.seq ?? -1;
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = transcript;
  // A deep link keeps loading ranges until its message is on the page: the head page
  // is byte-bounded, so long context records ahead of the target can fill it.
  useEffect(() => {
    if (selected === null || lastSeq >= selected) return;
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [selected, lastSeq, hasNextPage, isFetchingNextPage, fetchNextPage]);
  // Following the tail keeps loading ranges until the newest message is on screen,
  // then scrolls only when a newer message lands so a reader can still look back.
  // Scrolls this page starts itself must not count as the reader looking back.
  const ownScroll = useRef(false);
  useEffect(() => {
    if (!following || !active) return;
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
      return;
    }
    if (lastSeq >= 0) {
      ownScroll.current = true;
      // Instant, so the page's own scroll is one event the listener below can skip.
      document
        .getElementById(String(lastSeq))
        ?.scrollIntoView({ block: "end", behavior: "instant" });
      requestAnimationFrame(() => {
        ownScroll.current = false;
      });
    }
  }, [
    following,
    active,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    lastSeq,
  ]);
  // A reader who scrolls up while a live session streams stops following; the
  // "Show latest" banner and the switch turn it back on.
  useEffect(() => {
    if (!following || !active) return;
    const onScroll = () => {
      if (ownScroll.current) return;
      const root = document.documentElement;
      const fromBottom = root.scrollHeight - root.scrollTop - root.clientHeight;
      if (fromBottom > 160) setFollow(false);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
    };
  }, [following, active]);
  if (transcript.isPending) return <LoadingState />;
  if (transcript.error || !header)
    return (
      <RequestError
        title={labels.errors.header}
        error={transcript.error}
        retry={transcript.refetch}
      />
    );
  const nodes = tree.data?.nodes ?? [];
  const root = nodes.find((node) => node.session_id === header.root_session_id);
  // Only a live session a reader stopped following can be behind; ranges still landing
  // on first load are not news.
  const behind =
    active &&
    !following &&
    !hasNextPage &&
    !isFetchingNextPage &&
    latest > lastSeq;
  // Following a live session with pages still to load: catch up first, render once.
  const catchingUp = following && active && hasNextPage;
  return (
    <div className="flex flex-col gap-5">
      {header.parent_session_id && (
        <Alert
          variant="info"
          action={
            <Button asChild variant="secondary" size="sm">
              <Link
                to="/app/sessions/$id"
                params={{ id: header.root_session_id }}
              >
                {labels.openRoot}
              </Link>
            </Button>
          }
        >
          <span className="flex flex-wrap items-center gap-1.5">
            {labels.subagentRun}
            {header.parent_relation && (
              <StatusBadge value={header.parent_relation} />
            )}
            <Link
              to="/app/sessions/$id"
              params={{ id: header.root_session_id }}
              className="font-medium text-accent hover:underline"
            >
              {root?.title ?? header.parent?.title ?? labels.rootSession}
            </Link>
            {header.parent &&
              header.parent.session_id !== header.root_session_id && (
                <Link
                  to="/app/sessions/$id"
                  params={{ id: header.parent.session_id }}
                  className="text-muted hover:underline"
                >
                  {labels.openParent}
                </Link>
              )}
          </span>
        </Alert>
      )}
      {header.purged_at !== null && (
        <div data-testid="session-purged">
          <Alert variant="warning">{labels.moderation.purged}</Alert>
        </div>
      )}
      <SessionHeaderView
        header={header}
        stream={stream}
        related={nodes}
        actions={admin ? <ModerationMenu session={header} /> : undefined}
      />
      <ReuseCard sessionId={id} />
      <Tabs
        value={tab}
        onValueChange={(value) => {
          if (value === "transcript" || value === "files" || value === "raw")
            setTab(value);
        }}
      >
        <TabsList aria-label={labels.details}>
          <TabsTrigger value="transcript" data-testid="session-tab-transcript">
            {labels.tabs.transcript}
          </TabsTrigger>
          <TabsTrigger value="files" data-testid="session-tab-files">
            {labels.tabs.files}
            <Badge>{number(header.file_count)}</Badge>
          </TabsTrigger>
          <TabsTrigger value="raw" data-testid="session-tab-raw">
            {labels.tabs.raw}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="transcript" className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="relative min-w-0 flex-1 sm:max-w-xs">
              <Search
                size={15}
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
              />
              <Input
                type="search"
                aria-label={labels.transcript.find}
                placeholder={labels.transcript.find}
                value={find}
                className="h-8 pl-9 text-[13px]"
                onChange={(event) => {
                  setFind(event.target.value);
                }}
              />
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-muted">
              <Label className="flex cursor-pointer items-center gap-2 font-normal text-muted">
                <Switch
                  checked={expandThinking}
                  onCheckedChange={setExpandThinking}
                />
                {labels.transcript.expandThinking}
              </Label>
              <Label className="flex cursor-pointer items-center gap-2 font-normal text-muted">
                <Switch
                  checked={expandTools}
                  onCheckedChange={setExpandTools}
                />
                {labels.transcript.expandTools}
              </Label>
              {active && (
                <Label className="flex cursor-pointer items-center gap-2 font-normal text-muted">
                  <Switch checked={following} onCheckedChange={setFollow} />
                  {labels.transcript.followLatest}
                </Label>
              )}
              <span className="tabular-nums">
                {number(messages.length)}
                {copy.app.common.fractionSeparator}
                {number(header.message_count)} {labels.transcript.loaded}
              </span>
            </div>
          </div>
          {from > 0 && (
            <Alert
              action={
                <Button asChild variant="secondary" size="sm">
                  <Link to="/app/sessions/$id" params={{ id }}>
                    {labels.transcript.showFromStart}
                  </Link>
                </Button>
              }
            >
              {labels.transcript.startedFrom} {number(from)}
            </Alert>
          )}
          {behind && (
            <Alert
              variant="success"
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setFollow(true);
                  }}
                >
                  {labels.transcript.showLatest}
                </Button>
              }
            >
              {labels.transcript.newMessages}
            </Alert>
          )}
          <div
            data-testid="session-transcript"
            aria-label={labels.transcript.label}
          >
            {catchingUp ? (
              // Pages load back to back; the transcript renders once, at the tail.
              <p
                role="status"
                className="flex items-center justify-center gap-2 py-10 text-sm text-muted"
              >
                <Spinner size={14} />
                {labels.transcript.catchingUp}
              </p>
            ) : (
              <MessageList
                messages={messages}
                sessionId={id}
                selected={selected}
                find={find}
                expandThinking={expandThinking}
                expandTools={expandTools}
                nodes={nodes}
                focus={focus}
              />
            )}
          </div>
          {transcript.rangeError !== null && (
            <RequestError
              title={labels.errors.messages}
              error={transcript.rangeError}
              retry={transcript.retryRanges}
            />
          )}
          {hasNextPage && !catchingUp && (
            <LoadMore fetching={isFetchingNextPage} onLoad={fetchNextPage}>
              {isFetchingNextPage
                ? labels.transcript.loading
                : labels.transcript.loadMore}
            </LoadMore>
          )}
          {tree.error && (
            <RequestError
              title={labels.errors.runs}
              error={tree.error}
              retry={() => {
                void tree.refetch();
              }}
            />
          )}
          {(header.child_count > 0 ||
            nodes.some((node) => node.parent_session_id === id)) && (
            <SubagentRuns
              parentId={id}
              nodes={nodes}
              messages={messages}
              focus={focus}
              expandThinking={expandThinking}
              expandTools={expandTools}
            />
          )}
        </TabsContent>
        <TabsContent value="files">
          {tab === "files" && <FilesTab header={header} />}
        </TabsContent>
        <TabsContent value="raw">
          {tab === "raw" && <RawTab sessionId={id} />}
        </TabsContent>
      </Tabs>
    </div>
  );
}
