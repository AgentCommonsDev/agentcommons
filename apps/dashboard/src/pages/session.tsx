import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { copy } from "../copy";
import { api, unwrap } from "../lib/api/client";
import { number } from "../lib/display";
import { useSessionStream } from "../lib/use-session-stream";
import { useWorkspace } from "../components/app/workspace";
import {
  LoadingState,
  RequestError,
  StatusBadge,
} from "../components/app/states";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Label, Switch } from "../components/ui/field";
import { Alert } from "../components/ui/feedback";
import { Input } from "../components/ui/input";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../components/ui/tabs";
import { FilesTab } from "../features/sessions/files";
import { RawTab } from "../features/sessions/raw";
import { ReuseCard } from "../features/sessions/reuse";
import {
  SessionHeaderView,
  type StreamState,
} from "../features/sessions/session-header";
import { SubagentRuns } from "../features/sessions/subagents";
import {
  MessageList,
  transcriptMessages,
  useTranscript,
  type RunFocus,
} from "../features/sessions/transcript";

const labels = copy.sessions.detail;
type Tab = "transcript" | "files" | "raw";
/** One session page: header, reuse, transcript with inline subagent runs, files and raw records. */
export function SessionPage({ id, child }: { id: string; child?: string }) {
  const { organization } = useWorkspace();
  const hash = useRouterState({
    select: (state) => state.location.hash.replace(/^#/, ""),
  });
  const seq =
    /^\d+$/.test(hash) && Number.isSafeInteger(Number(hash))
      ? Number(hash)
      : null;
  // With `child`, the hash names a message inside that nested run, not this transcript.
  const selected = child === undefined ? seq : null;
  const focus: RunFocus | null =
    child === undefined ? null : { sessionId: child, seq };
  // Two messages of context above a deep-linked message.
  const from = selected === null ? 0 : Math.max(0, selected - 2);
  const [tab, setTab] = useState<Tab>("transcript");
  // Null until the event stream reports; the transcript polls until it does.
  const [connected, setConnected] = useState<boolean | null>(null);
  const [latest, setLatest] = useState(0);
  // Null until the reader chooses; live sessions follow their tail unless deep-linked.
  const [follow, setFollow] = useState<boolean | null>(null);
  const [find, setFind] = useState("");
  const [expandThinking, setExpandThinking] = useState(false);
  const [expandTools, setExpandTools] = useState(false);
  const transcript = useTranscript(id, from, { polling: connected !== true });
  const header = transcript.data?.pages[0]?.header;
  const active = header?.status === "ACTIVE";
  const following = follow ?? (active && selected === null && focus === null);
  const stream: StreamState | undefined = active
    ? connected === null
      ? "connecting"
      : connected
        ? "streaming"
        : "reconnecting"
    : undefined;
  useSessionStream(organization.id, id, active, setConnected, setLatest);
  useEffect(() => {
    if (header) setLatest((prior) => Math.max(prior, header.message_count - 1));
  }, [header]);
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
  const messages = useMemo(
    () => (transcript.data ? transcriptMessages(transcript.data.pages) : []),
    [transcript.data],
  );
  const lastSeq = messages.at(-1)?.seq ?? -1;
  // A deep link keeps loading pages until its message is on the page: a page is
  // byte-bounded, so long context records ahead of the target can fill the first one.
  useEffect(() => {
    if (selected === null || lastSeq >= selected) return;
    if (transcript.hasNextPage && !transcript.isFetchingNextPage)
      void transcript.fetchNextPage();
  }, [selected, lastSeq, transcript]);
  // Following the tail keeps loading pages until the newest message is on screen,
  // then scrolls only when a newer message lands so a reader can still look back.
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = transcript;
  useEffect(() => {
    if (!following || !active) return;
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
      return;
    }
    if (lastSeq >= 0)
      document
        .getElementById(String(lastSeq))
        ?.scrollIntoView({ block: "end" });
  }, [
    following,
    active,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    lastSeq,
  ]);
  if (transcript.isPending) return <LoadingState />;
  if (transcript.error || !header)
    return (
      <RequestError
        error={transcript.error}
        retry={() => {
          void transcript.refetch();
        }}
      />
    );
  const nodes = tree.data?.nodes ?? [];
  const root = nodes.find((node) => node.session_id === header.root_session_id);
  const behind = !following && !transcript.hasNextPage && latest > lastSeq;
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
      <SessionHeaderView header={header} stream={stream} related={nodes} />
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
          </div>
          {transcript.hasNextPage && (
            <Button
              variant="secondary"
              className="self-center"
              disabled={transcript.isFetchingNextPage}
              onClick={() => {
                void transcript.fetchNextPage();
              }}
            >
              {transcript.isFetchingNextPage
                ? labels.transcript.loading
                : labels.transcript.loadMore}
            </Button>
          )}
          {tree.error && (
            <RequestError
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
