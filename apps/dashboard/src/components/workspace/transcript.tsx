import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { formatMessage } from "@agentcommons/core/format";
import { copy } from "../../copy";
import { dateTime, number } from "../../lib/display";
import type { Message } from "../../lib/types";
import {
  CopyButton,
  EmptyState,
  StatusBadge,
  ShortenedFields,
} from "./primitives";
import { Markdown } from "./markdown";
export function Transcript({
  messages,
  selected,
}: {
  messages: Message[];
  selected: number | null;
}) {
  const [find, setFind] = useState("");
  const [thinking, setThinking] = useState(true);
  const [collapseTools, setCollapseTools] = useState(true);
  const filtered = useMemo(
    () =>
      messages.filter(
        (message) =>
          (thinking || message.kind !== "THINKING") &&
          (find === "" ||
            message.content.toLowerCase().includes(find.toLowerCase())),
      ),
    [messages, thinking, find],
  );
  const parent = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parent.current,
    estimateSize: () => 180,
    overscan: 3,
  });
  return (
    <div className="transcript">
      <div className="transcript-controls">
        <input
          type="search"
          aria-label={copy.workspace.detail.transcriptSearch}
          placeholder={copy.workspace.detail.transcriptSearch}
          value={find}
          onChange={(event) => {
            setFind(event.target.value);
          }}
        />
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={thinking}
            onChange={(event) => {
              setThinking(event.target.checked);
            }}
          />
          {copy.workspace.detail.thinking}
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={collapseTools}
            onChange={(event) => {
              setCollapseTools(event.target.checked);
            }}
          />
          {copy.workspace.detail.collapseTools}
        </label>
      </div>
      <div
        ref={parent}
        className="transcript-scroll"
        role="region"
        aria-label={copy.workspace.detail.transcript}
        tabIndex={0}
      >
        {filtered.length === 0 ? (
          <EmptyState title={copy.workspace.detail.noMessages} />
        ) : (
          <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
            {virtual.getVirtualItems().map((item) => {
              const message = filtered[item.index];
              if (!message) return null;
              const previous = filtered[item.index - 1];
              const collapsible =
                message.kind === "TOOL_USE" || message.kind === "TOOL_RESULT";
              const metadata = `${copy.workspace.fields.raw_record_id}: ${message.raw_record_id ?? copy.workspace.common.unavailable}\n${copy.workspace.fields.ingest_batch_id}: ${message.ingest_batch_id ?? copy.workspace.common.unavailable}\n${copy.workspace.fields.input_tokens}: ${number(message.input_tokens)}\n${copy.workspace.fields.output_tokens}: ${number(message.output_tokens)}`;
              return (
                <article
                  className={
                    selected === message.seq
                      ? "transcript-message selected"
                      : "transcript-message"
                  }
                  id={String(message.seq)}
                  key={`${message.message_id}-${String(item.index)}`}
                  ref={virtual.measureElement}
                  data-index={item.index}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${String(item.start)}px)`,
                  }}
                >
                  <div className="transcript-message-header">
                    <div>
                      <a
                        href={`#${String(message.seq)}`}
                        aria-label={`${copy.workspace.detail.seqLink} ${String(message.seq)}`}
                      >
                        {message.seq}
                      </a>
                      <StatusBadge value={message.role} />
                      <StatusBadge value={message.kind} />
                      {message.tool_name && (
                        <strong>{message.tool_name}</strong>
                      )}
                    </div>
                    <div>
                      <time dateTime={message.timestamp ?? undefined}>
                        {dateTime(message.timestamp)}
                      </time>
                      <CopyButton
                        value={formatMessage(message)}
                        label={copy.workspace.detail.copyMessage}
                      />
                      <CopyButton
                        value={`${window.location.origin}/s/${message.session_id}#${String(message.seq)}`}
                        label={copy.workspace.detail.messageLink}
                      />
                    </div>
                  </div>
                  {message.model && message.model !== previous?.model && (
                    <div className="message-model">
                      {copy.workspace.fields.model}
                      {copy.workspace.common.separator}
                      {message.model}
                    </div>
                  )}
                  <ShortenedFields fields={message.truncated_fields} />
                  {collapsible ? (
                    <details
                      open={!collapseTools}
                      className="tool-message"
                      key={`${message.message_id}-${String(collapseTools)}`}
                    >
                      <summary>
                        <ChevronDown size={14} aria-hidden />
                        {message.tool_name ??
                          copy.workspace.statuses[message.kind]}
                        <span>{copy.workspace.detail.showContent}</span>
                      </summary>
                      <Markdown content={message.content} />
                    </details>
                  ) : (
                    <Markdown content={message.content} />
                  )}
                  <div className="transcript-message-footer">
                    <details>
                      <summary title={metadata}>
                        {copy.workspace.detail.source}
                      </summary>
                      <dl>
                        <div>
                          <dt>{copy.workspace.fields.message_id}</dt>
                          <dd>
                            {message.message_id}
                            <CopyButton value={message.message_id} />
                          </dd>
                        </div>
                        <div>
                          <dt>{copy.workspace.fields.raw_record_id}</dt>
                          <dd>
                            {message.raw_record_id ??
                              copy.workspace.common.unavailable}
                            {message.raw_record_id && (
                              <CopyButton value={message.raw_record_id} />
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt>{copy.workspace.fields.ingest_batch_id}</dt>
                          <dd>
                            {message.ingest_batch_id ??
                              copy.workspace.common.unavailable}
                            {message.ingest_batch_id && (
                              <CopyButton value={message.ingest_batch_id} />
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt>{copy.workspace.fields.input_tokens}</dt>
                          <dd>{number(message.input_tokens)}</dd>
                        </div>
                        <div>
                          <dt>{copy.workspace.fields.output_tokens}</dt>
                          <dd>{number(message.output_tokens)}</dd>
                        </div>
                        <div>
                          <dt>{copy.workspace.fields.tool_use_id}</dt>
                          <dd>
                            {message.tool_use_id ??
                              copy.workspace.common.unavailable}
                          </dd>
                        </div>
                        <div>
                          <dt>{copy.workspace.fields.agent_id}</dt>
                          <dd>
                            {message.agent_id ??
                              copy.workspace.common.unavailable}
                          </dd>
                        </div>
                        <div>
                          <dt>{copy.workspace.fields.received_at}</dt>
                          <dd>{dateTime(message.received_at)}</dd>
                        </div>
                      </dl>
                    </details>
                    {message.content_cursor && (
                      <span>{copy.workspace.detail.fullContent}</span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
