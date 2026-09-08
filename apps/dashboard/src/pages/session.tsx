import { useEffect, useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { useQuery } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { Radio } from "lucide-react";
import type { ContentCursor } from "@agentcommons/core/schemas/get";
import { copy } from "../copy";
import { api, unwrap } from "../lib/api/client";
import { useSessionStream } from "../lib/use-session-stream";
import { dateTime } from "../lib/display";
import { useWorkspace } from "../components/workspace/context";
import { SessionReuse } from "../components/workspace/session-reuse";
import { SimilarSessions } from "../components/workspace/similar-sessions";
import { SessionSummary } from "../components/workspace/session-header";
import { SessionTree } from "../components/workspace/tree";
import { RawDownload } from "../components/workspace/raw-download";
import { Transcript } from "../components/workspace/transcript";
import {
  CopyButton,
  EmptyState,
  LoadingState,
  RequestError,
} from "../components/workspace/primitives";
import { Button } from "../components/ui/button";
export function SessionPage({ id }: { id: string }) {
  const { organization } = useWorkspace();
  const hash = useRouterState({
    select: (state) => state.location.hash.replace(/^#/, ""),
  });
  const selected =
    /^\d+$/.test(hash) && Number.isSafeInteger(Number(hash))
      ? Number(hash)
      : null;
  const [tab, setTab] = useState<"transcript" | "raw" | "tree">("transcript");
  const [cursors, setCursors] = useState<(ContentCursor | null)[]>([null]);
  const [rawCursors, setRawCursors] = useState<(string | null)[]>([null]);
  const [treeCursors, setTreeCursors] = useState<(string | null)[]>([null]);
  const [streamConnected, setStreamConnected] = useState(false);
  const [followLatest, setFollowLatest] = useState(false);
  const [latestSequence, setLatestSequence] = useState(0);
  const from = followLatest ? latestSequence : selected;
  const cursor = followLatest ? null : (cursors.at(-1) ?? null);
  const query = useQuery({
    queryKey: [organization.id, "session", id, from, cursor],
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET("/api/v1/sessions/{id}", {
          params: {
            path: { id },
            query: {
              ...(from === null ? {} : { from }),
              cursor,
            },
          },
          signal,
        }),
      ),
    refetchInterval: (state) =>
      state.state.data?.header.status === "ACTIVE" && !streamConnected
        ? 5000
        : false,
  });
  useEffect(() => {
    if (query.data)
      setLatestSequence(Math.max(0, query.data.header.message_count - 1));
  }, [query.data?.header.message_count]);
  useSessionStream(
    organization.id,
    id,
    query.data?.header.status === "ACTIVE",
    setStreamConnected,
    setLatestSequence,
  );
  const raw = useQuery({
    queryKey: [organization.id, "raw", id, rawCursors.at(-1)],
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET("/api/v1/sessions/{id}/raw", {
          params: {
            path: { id },
            query: { cursor: rawCursors.at(-1) ?? null, limit: 25 },
          },
          signal,
        }),
      ),
    enabled: tab === "raw",
  });
  const tree = useQuery({
    queryKey: [organization.id, "tree", id, treeCursors.at(-1)],
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET("/api/v1/sessions/{id}/tree", {
          params: {
            path: { id },
            query: { cursor: treeCursors.at(-1) ?? null, limit: 50 },
          },
          signal,
        }),
      ),
    enabled: tab === "tree",
  });
  if (query.isPending) return <LoadingState />;
  if (query.error)
    return (
      <RequestError
        error={query.error}
        retry={() => {
          void query.refetch();
        }}
      />
    );
  return (
    <>
      <SessionSummary header={query.data.header} />
      <Tabs.Root
        value={tab}
        onValueChange={(value) => {
          if (value === "transcript" || value === "raw" || value === "tree")
            setTab(value);
        }}
      >
        <Tabs.List
          className="workspace-tabs"
          aria-label={copy.workspace.detail.details}
        >
          {(["transcript", "raw", "tree"] as const).map((value) => (
            <Tabs.Trigger value={value} key={value}>
              {copy.workspace.detail[value]}
            </Tabs.Trigger>
          ))}
          <span className="session-live">
            <Radio size={14} aria-hidden />
            {query.data.header.status === "ACTIVE"
              ? streamConnected
                ? copy.workspace.detail.live
                : copy.workspace.detail.polling
              : copy.workspace.detail.stopped}
          </span>
        </Tabs.List>
        <Tabs.Content value="transcript">
          <label className="checkbox-field follow-latest">
            <input
              type="checkbox"
              checked={followLatest}
              onChange={(event) => {
                setFollowLatest(event.target.checked);
              }}
            />
            {copy.workspace.detail.followLatest}
          </label>
          <Transcript
            key={`${id}-${String(cursors.length)}-${String(from)}`}
            messages={query.data.messages}
            selected={from}
          />
          <div className="table-pagination">
            <Button
              variant="secondary"
              disabled={followLatest || cursors.length === 1}
              onClick={() => {
                setCursors((prior) => prior.slice(0, -1));
              }}
            >
              {copy.workspace.detail.previous}
            </Button>
            <Button
              variant="secondary"
              disabled={followLatest || query.data.next === null}
              onClick={() => {
                const next = query.data.next;
                if (next) setCursors((prior) => [...prior, next]);
              }}
            >
              {copy.workspace.detail.next}
            </Button>
          </div>
        </Tabs.Content>
        <Tabs.Content value="raw">
          {raw.isPending && <LoadingState />}
          {raw.error && (
            <RequestError
              error={raw.error}
              retry={() => {
                void raw.refetch();
              }}
            />
          )}
          {raw.data && (
            <>
              <p className="panel-description">
                {copy.workspace.detail.rawDescription}
              </p>
              {raw.data.items.length === 0 && (
                <EmptyState title={copy.workspace.detail.noRaw} />
              )}
              {raw.data.items.map((record) => {
                const payload =
                  record.payload_fragment && typeof record.payload === "string"
                    ? record.payload
                    : JSON.stringify(record.payload, null, 2);
                return (
                  <details
                    className="raw-record"
                    key={`${record.id}-${String(record.payload_fragment?.offset ?? 0)}`}
                  >
                    <summary>
                      <span>{record.record_type}</span>
                      <code>{record.pos}</code>
                      <span>
                        {copy.workspace.fields.source_version}
                        {copy.workspace.common.separator}
                        {record.source_version}
                      </span>
                      <time dateTime={record.received_at}>
                        {dateTime(record.received_at)}
                      </time>
                    </summary>
                    <div className="raw-record-meta">
                      <span>{record.id}</span>
                      <CopyButton value={record.id} />
                      {record.payload_fragment && (
                        <span>
                          {copy.workspace.detail.rawContinued}
                          {copy.workspace.common.separator}
                          {record.payload_fragment.offset}
                        </span>
                      )}
                      <CopyButton value={payload} />
                      <RawDownload record={record} cursor={raw.data.cursor} />
                    </div>
                    <pre
                      tabIndex={0}
                      role="region"
                      aria-label={copy.workspace.fields.payload}
                    >
                      {payload}
                    </pre>
                  </details>
                );
              })}
              <div className="table-pagination">
                <Button
                  variant="secondary"
                  disabled={rawCursors.length === 1}
                  onClick={() => {
                    setRawCursors((prior) => prior.slice(0, -1));
                  }}
                >
                  {copy.workspace.common.previous}
                </Button>
                <Button
                  variant="secondary"
                  disabled={raw.data.cursor === null}
                  onClick={() => {
                    const cursor = raw.data.cursor;
                    if (cursor) setRawCursors((prior) => [...prior, cursor]);
                  }}
                >
                  {copy.workspace.common.next}
                </Button>
              </div>
            </>
          )}
        </Tabs.Content>
        <Tabs.Content value="tree">
          {tree.isPending && <LoadingState />}
          {tree.error && (
            <RequestError
              error={tree.error}
              retry={() => {
                void tree.refetch();
              }}
            />
          )}
          {tree.data && (
            <>
              <SessionTree nodes={tree.data.nodes} current={id} />
              <div className="table-pagination">
                <Button
                  variant="secondary"
                  disabled={treeCursors.length === 1}
                  onClick={() => {
                    setTreeCursors((prior) => prior.slice(0, -1));
                  }}
                >
                  {copy.workspace.common.previous}
                </Button>
                <Button
                  variant="secondary"
                  disabled={tree.data.cursor === null}
                  onClick={() => {
                    const cursor = tree.data.cursor;
                    if (cursor) setTreeCursors((prior) => [...prior, cursor]);
                  }}
                >
                  {copy.workspace.detail.treeMore}
                </Button>
              </div>
            </>
          )}
        </Tabs.Content>
      </Tabs.Root>
      <SessionReuse sessionId={id} />
      <SimilarSessions sessionId={id} />
    </>
  );
}
