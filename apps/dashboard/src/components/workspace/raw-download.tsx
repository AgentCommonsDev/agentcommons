import { useEffect, useRef, useState } from "react";
import { jsonValueSchema } from "@agentcommons/core/schemas/common";
import { Download, X } from "lucide-react";
import { copy } from "../../copy";
import { api, unwrap } from "../../lib/api/client";
import { downloadBlob } from "../../lib/csv";
import { errorMessage } from "../../lib/display";
import type { RawRecord } from "../../lib/types";
import { Button } from "../ui/button";

export function RawDownload({
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
          throw new Error(copy.workspace.detail.rawRestart);
        const chunks = [payload];
        let offset = record.payload_fragment.next_offset;
        let next = cursor;
        while (offset !== null) {
          if (next === null)
            throw new Error(copy.workspace.detail.rawIncomplete);
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
            throw new Error(copy.workspace.detail.rawRestart);
          const nextOffset = fragment.payload_fragment.next_offset;
          if (
            nextOffset !== null &&
            nextOffset !==
              offset + new TextEncoder().encode(fragment.payload).byteLength
          )
            throw new Error(copy.workspace.detail.rawIncomplete);
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
          `${copy.workspace.detail.rawFilePrefix}${record.id}.json`,
        );
    } catch (caught) {
      if (!abort.signal.aborted) setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="raw-download">
      <Button
        size="small"
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
        <Download size={14} aria-hidden />
        {pending
          ? copy.workspace.common.exporting
          : copy.workspace.detail.rawDownload}
      </Button>
      {pending && (
        <Button
          size="icon"
          variant="ghost"
          aria-label={copy.workspace.common.cancelExport}
          onClick={() => {
            controller.current?.abort();
          }}
        >
          <X size={14} aria-hidden />
        </Button>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </div>
  );
}
