import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronRight,
  GitFork,
  MessageSquare,
  ExternalLink,
} from "lucide-react";
import { messageBranches } from "@agentcommons/core/format";
import type { ContentCursor } from "@agentcommons/core/schemas/get";
import { copy } from "../../copy";
import { api, unwrap } from "../../lib/api/client";
import type { TreeNode, Message } from "../../lib/types";
import { dateTime, number, harnessLabel } from "../../lib/display";
import { useWorkspace } from "./context";
import {
  EmptyState,
  StatusBadge,
  LoadingState,
  RequestError,
} from "./primitives";
import { Markdown } from "./markdown";
import { Button } from "../ui/button";
import "./session-navigation.css";

function MessageNode({
  message,
  children,
}: {
  message: Message;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="agent-message-node" data-message-seq={message.seq}>
      <div className="agent-message-heading">
        <button
          className="agent-outline-toggle"
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
          }}
        >
          <ChevronRight
            size={14}
            aria-hidden
            className={open ? "rotated" : ""}
          />
          <span className="agent-message-seq">{message.seq}</span>
          <span className="agent-message-label">
            <strong>
              {message.tool_name ??
                copy.workspace.statuses[
                  message.kind === "TEXT" ? message.role : message.kind
                ]}
            </strong>
            <span>
              {message.content.replace(/\s+/g, " ").slice(0, 160) ||
                copy.workspace.common.unavailable}
            </span>
          </span>
        </button>
        <a
          className="agent-message-link"
          href={`/s/${message.session_id}#${String(message.seq)}`}
          aria-label={`${copy.workspace.detail.treeMessage} ${String(message.seq)}`}
        >
          <ExternalLink size={14} aria-hidden />
        </a>
      </div>
      {open && (
        <div className="agent-message-content">
          <Markdown content={message.content} />
          <a href={`/s/${message.session_id}#${String(message.seq)}`}>
            {copy.workspace.detail.treeOpen}
          </a>
        </div>
      )}
      {children}
    </li>
  );
}

function SessionMessages({ id }: { id: string }) {
  const { organization } = useWorkspace();
  const [cursors, setCursors] = useState<(ContentCursor | null)[]>([null]);
  const cursor = cursors.at(-1) ?? null;
  const query = useQuery({
    queryKey: [organization.id, "tree-messages", id, cursor],
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET("/api/v1/sessions/{id}", {
          params: { path: { id }, query: { cursor } },
          signal,
        }),
      ),
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
  const branches = messageBranches(query.data.messages);
  return (
    <section
      className="agent-session-messages"
      aria-label={copy.workspace.detail.treeMessages}
    >
      {branches.length === 0 ? (
        <p className="workspace-muted">
          {copy.workspace.detail.treeEmptyMessages}
        </p>
      ) : (
        <ol className="agent-message-list">
          {branches.map(({ message, results }) => (
            <MessageNode message={message} key={message.message_id}>
              {results.length > 0 && (
                <ol>
                  {results.map((result) => (
                    <MessageNode message={result} key={result.message_id} />
                  ))}
                </ol>
              )}
            </MessageNode>
          ))}
        </ol>
      )}
      {(cursors.length > 1 || query.data.next) && (
        <div className="agent-message-pagination">
          <Button
            variant="secondary"
            disabled={cursors.length === 1}
            onClick={() => {
              setCursors((prior) => prior.slice(0, -1));
            }}
          >
            {copy.workspace.detail.previous}
          </Button>
          <Button
            variant="secondary"
            disabled={!query.data.next}
            onClick={() => {
              const next = query.data.next;
              if (next) setCursors((prior) => [...prior, next]);
            }}
          >
            {copy.workspace.detail.next}
          </Button>
        </div>
      )}
    </section>
  );
}

function SessionNode({
  node,
  current,
  initiallyOpen,
  children,
}: {
  node: TreeNode;
  current: boolean;
  initiallyOpen: boolean;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const [messagesOpen, setMessagesOpen] = useState(current);
  const labels = copy.workspace.detail;
  return (
    <li className="agent-session-node" data-session-id={node.session_id}>
      <div
        className={`tree-node agent-session-card${current ? " current" : ""}`}
      >
        {node.gap ? (
          <p>{labels.hiddenGap}</p>
        ) : (
          <>
            <div className="agent-session-heading">
              <button
                className="agent-outline-toggle"
                aria-expanded={open}
                onClick={() => {
                  setOpen(!open);
                }}
              >
                <ChevronRight
                  size={17}
                  aria-hidden
                  className={open ? "rotated" : ""}
                />
                <GitFork size={17} aria-hidden />
                <span>
                  {node.parent_relation
                    ? copy.workspace.statuses[node.parent_relation]
                    : labels.rootSession}
                  {node.agent_type
                    ? `${copy.workspace.common.separator}${node.agent_type}`
                    : ""}
                </span>
              </button>
              <StatusBadge value={node.status} />
              {current && (
                <span className="agent-current-label">
                  {labels.treeCurrent}
                </span>
              )}
            </div>
            <a className="agent-session-title" href={`/s/${node.session_id}`}>
              {node.title ?? copy.workspace.sessions.untitled}
            </a>
            <div className="agent-session-meta">
              <span>{harnessLabel(node.harness)}</span>
              <span>
                {number(node.message_count)}{" "}
                {copy.workspace.fields.message_count.toLowerCase()}
              </span>
              <time dateTime={node.started_at}>
                {dateTime(node.started_at)}
              </time>
            </div>
          </>
        )}
        {open && !node.gap && (
          <>
            <button
              className="agent-messages-toggle"
              aria-expanded={messagesOpen}
              onClick={() => {
                setMessagesOpen(!messagesOpen);
              }}
            >
              <ChevronRight
                size={14}
                aria-hidden
                className={messagesOpen ? "rotated" : ""}
              />
              <MessageSquare size={14} aria-hidden />
              {labels.treeMessages}
            </button>
            {messagesOpen && <SessionMessages id={node.session_id} />}
          </>
        )}
      </div>
      {(open || node.gap) && children}
    </li>
  );
}

export function SessionTree({
  nodes,
  current,
}: {
  nodes: TreeNode[];
  current: string;
}) {
  const ids = new Set(nodes.map((node) => node.session_id));
  const ancestors = new Set<string>([current]);
  let ancestor = nodes.find(
    (node) => node.session_id === current,
  )?.parent_session_id;
  while (ancestor && !ancestors.has(ancestor)) {
    ancestors.add(ancestor);
    ancestor = nodes.find(
      (node) => node.session_id === ancestor,
    )?.parent_session_id;
  }
  const children = new Map<string, TreeNode[]>();
  for (const node of nodes) {
    const parent =
      node.parent_session_id && ids.has(node.parent_session_id)
        ? node.parent_session_id
        : "";
    const group = children.get(parent) ?? [];
    group.push(node);
    children.set(parent, group);
  }
  const render = (parent: string, seen: Set<string>): ReactNode => (
    <ul className="agent-session-list">
      {(children.get(parent) ?? [])
        .filter((node) => !seen.has(node.session_id))
        .map((node) => (
          <SessionNode
            node={node}
            current={node.session_id === current}
            initiallyOpen={ancestors.has(node.session_id)}
            key={node.session_id}
          >
            {children.has(node.session_id) && (
              <div className="agent-related-sessions">
                <p>{copy.workspace.detail.treeChildren}</p>
                {render(node.session_id, new Set([...seen, node.session_id]))}
              </div>
            )}
          </SessionNode>
        ))}
    </ul>
  );
  return nodes.length === 0 ? (
    <EmptyState title={copy.workspace.detail.noRelations} />
  ) : (
    <div className="session-tree agent-tree">
      <p className="panel-description">
        {copy.workspace.detail.treeDescription}
      </p>
      {render("", new Set())}
    </div>
  );
}
