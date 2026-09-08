import { copy } from "../../copy";
import type { TreeNode } from "../../lib/types";
import { dateTime, number, harnessLabel } from "../../lib/display";
import { EmptyState, StatusBadge } from "./primitives";
export function SessionTree({
  nodes,
  current,
}: {
  nodes: TreeNode[];
  current: string;
}) {
  const ids = new Set(nodes.map((node) => node.session_id));
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
  const render = (parent: string, seen: Set<string>): React.ReactNode => (
    <ul>
      {(children.get(parent) ?? [])
        .filter((node) => !seen.has(node.session_id))
        .map((node) => (
          <li key={node.session_id}>
            <div
              className={
                node.session_id === current ? "tree-node current" : "tree-node"
              }
            >
              {node.gap ? (
                <span>{copy.workspace.detail.hiddenGap}</span>
              ) : (
                <>
                  <a
                    href={`/s/${node.session_id}`}
                    aria-current={
                      node.session_id === current ? "page" : undefined
                    }
                  >
                    {node.title ?? copy.workspace.sessions.untitled}
                  </a>
                  <div>
                    <StatusBadge value={node.status} />
                    {node.parent_relation && (
                      <StatusBadge value={node.parent_relation} />
                    )}
                    {node.agent_type && <span>{node.agent_type}</span>}
                    <span>{harnessLabel(node.harness)}</span>
                    <span>
                      {number(node.message_count)}
                      {copy.workspace.common.separator}
                      {copy.workspace.fields.message_count}
                    </span>
                    <time dateTime={node.started_at}>
                      {dateTime(node.started_at)}
                    </time>
                  </div>
                </>
              )}
            </div>
            {children.has(node.session_id) &&
              render(node.session_id, new Set([...seen, node.session_id]))}
          </li>
        ))}
    </ul>
  );
  return nodes.length === 0 ? (
    <EmptyState title={copy.workspace.detail.noRelations} />
  ) : (
    <div className="session-tree">{render("", new Set())}</div>
  );
}
