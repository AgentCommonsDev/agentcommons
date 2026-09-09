import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Download, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { jsonValueSchema } from "@agentcommons/core/schemas/common";
import { copy } from "../../copy";
import { api, unwrap } from "../../lib/api/client";
import { downloadBlob } from "../../lib/csv";
import { dateTime, errorMessage, number } from "../../lib/display";
import type { RawRecord } from "../../lib/types";
import { useWorkspace } from "../../components/app/workspace";
import {
  CopyButton,
  LoadingState,
  RequestError,
} from "../../components/app/states";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/feedback";

const labels = copy.sessions.detail.raw;
const positionLabel = (pos: string) => `#${pos}`;
/** Reassemble a fragmented payload by walking the digest-bound continuation cursor. */
function RawDownload({
  record,
  cursor,
}: {
  record: RawRecord;
  cursor: string | null;
}) {
  const controller = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );
  const download = async () => {
    const abort = new AbortController();
    controller.current = abort;
    setPending(true);
    setError(null);
    try {
      let payload = record.payload;
      if (record.payload_fragment) {
        if (record.payload_fragment.offset !== 0 || typeof payload !== "string")
          throw new Error(labels.restart);
        const chunks = [payload];
        let offset = record.payload_fragment.next_offset;
        let next = cursor;
        while (offset !== null) {
          if (next === null) throw new Error(labels.incomplete);
          const page = unwrap(
            await api.GET("/api/v1/sessions/{id}/raw", {
              params: {
                path: { id: record.session_id },
                query: { cursor: next, limit: 25 },
              },
              signal: abort.signal,
            }),
          );
          const fragment = page.items[0];
          if (
            !fragment ||
            fragment.id !== record.id ||
            fragment.pos !== record.pos ||
            fragment.source_version !== record.source_version ||
            fragment.payload_fragment?.offset !== offset ||
            typeof fragment.payload !== "string"
          )
            throw new Error(labels.restart);
          const nextOffset = fragment.payload_fragment.next_offset;
          if (
            nextOffset !== null &&
            nextOffset !==
              offset + new TextEncoder().encode(fragment.payload).byteLength
          )
            throw new Error(labels.incomplete);
          chunks.push(fragment.payload);
          offset = nextOffset;
          next = page.cursor;
        }
        payload = jsonValueSchema.parse(JSON.parse(chunks.join("")));
      }
      if (!abort.signal.aborted)
        downloadBlob(
          new Blob([JSON.stringify(payload, null, 2)], {
            type: "application/json",
          }),
          `${labels.filePrefix}${record.id}.json`,
        );
    } catch (caught) {
      if (!abort.signal.aborted) setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="secondary"
        disabled={
          pending ||
          (record.payload_fragment !== null &&
            record.payload_fragment.offset !== 0)
        }
        onClick={() => {
          void download();
        }}
      >
        <Download aria-hidden />
        {pending ? labels.downloading : labels.download}
      </Button>
      {pending && (
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={copy.app.common.cancelExport}
          onClick={() => {
            controller.current?.abort();
          }}
        >
          <X aria-hidden />
        </Button>
      )}
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </span>
  );
}
function RawRecordView({
  record,
  cursor,
}: {
  record: RawRecord;
  cursor: string | null;
}) {
  const [open, setOpen] = useState(false);
  const payload =
    record.payload_fragment && typeof record.payload === "string"
      ? record.payload
      : JSON.stringify(record.payload, null, 2);
  return (
    <li className="overflow-hidden rounded-lg border border-line bg-surface">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen((prior) => !prior);
        }}
        className="flex w-full cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left text-sm hover:bg-raised/60 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent sm:px-4"
      >
        <span className="font-mono text-xs text-muted">
          {positionLabel(record.pos)}
        </span>
        <span className="font-medium">{record.record_type}</span>
        <Badge variant="outline">
          {copy.app.fields.source_version}
          {copy.app.common.separator}
          {number(record.source_version)}
        </Badge>
        {record.payload_fragment && (
          <Badge variant="warning">
            {labels.fragment} {number(record.payload_fragment.offset)}
          </Badge>
        )}
        <time
          dateTime={record.received_at}
          className="ml-auto text-xs text-muted"
        >
          {dateTime(record.received_at)}
        </time>
      </button>
      {open && (
        <div className="flex flex-col gap-3 border-t border-line-soft p-3 sm:p-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted">
            <span className="flex items-center gap-1">
              <span>{copy.app.fields.raw_record_id}</span>
              <span className="font-mono text-fg">{record.id}</span>
              <CopyButton value={record.id} />
            </span>
            {record.key && (
              <span className="flex items-center gap-1">
                <span>{copy.app.fields.key}</span>
                <span className="font-mono text-fg">{record.key}</span>
              </span>
            )}
            <span className="flex items-center gap-1">
              <span>{copy.app.fields.ingest_batch_id}</span>
              <span className="font-mono text-fg">
                {record.ingest_batch_id}
              </span>
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CopyButton
              value={payload}
              label={labels.copyPayload}
              showLabel
              size="sm"
              variant="secondary"
            />
            <RawDownload record={record} cursor={cursor} />
          </div>
          <pre
            tabIndex={0}
            aria-label={labels.payload}
            className="m-0 max-h-[28rem] overflow-auto rounded-md bg-bg px-3 py-2 font-mono text-[12px] leading-relaxed break-words whitespace-pre-wrap"
          >
            {payload}
          </pre>
        </div>
      )}
    </li>
  );
}
export function RawTab({ sessionId }: { sessionId: string }) {
  const { organization } = useWorkspace();
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors.at(-1) ?? null;
  const raw = useQuery({
    queryKey: [organization.id, "raw", sessionId, cursor],
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET("/api/v1/sessions/{id}/raw", {
          params: { path: { id: sessionId }, query: { cursor, limit: 25 } },
          signal,
        }),
      ),
  });
  if (raw.isPending) return <LoadingState />;
  if (raw.error)
    return (
      <RequestError
        error={raw.error}
        retry={() => {
          void raw.refetch();
        }}
      />
    );
  return (
    <div className="flex flex-col gap-3" aria-label={labels.label}>
      <p className="text-sm text-muted">{labels.description}</p>
      {raw.data.items.length === 0 ? (
        <EmptyState
          compact
          title={labels.empty}
          description={labels.emptyHint}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {raw.data.items.map((record) => (
            <RawRecordView
              key={`${record.id}-${String(record.payload_fragment?.offset ?? 0)}`}
              record={record}
              cursor={raw.data.cursor}
            />
          ))}
        </ul>
      )}
      {(cursors.length > 1 || raw.data.cursor) && (
        <div className="flex items-center justify-between gap-2">
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
            disabled={raw.data.cursor === null}
            onClick={() => {
              const next = raw.data.cursor;
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
