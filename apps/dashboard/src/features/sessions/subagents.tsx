import { spawnPlacements } from "@agentcommons/core/format";
import { copy } from "../../copy";
import { number } from "../../lib/display";
import type { Message, TreeNode } from "../../lib/types";
import { EmptyState } from "../../components/ui/feedback";
import { RunList, type RunFocus } from "./transcript";

const labels = copy.sessions.detail.subagents;
/** Child sessions belong to their parent's page. A run whose spawning call is on a loaded
 * page nests under that call in the transcript; this section lists the rest, and it
 * disappears once every child has found its call. */
export function SubagentRuns({
  parentId,
  nodes,
  messages,
  focus = null,
  expandThinking,
  expandTools,
}: {
  parentId: string;
  nodes: readonly TreeNode[];
  /** The parent's loaded messages, which decide what has already been placed. */
  messages: readonly Message[];
  focus?: RunFocus | null;
  expandThinking: boolean;
  expandTools: boolean;
}) {
  const children = nodes.filter((node) => node.parent_session_id === parentId);
  const { unplaced } = spawnPlacements(messages, children, parentId);
  if (children.length > 0 && unplaced.length === 0) return null;
  return (
    <section
      id="subagents"
      aria-label={labels.title}
      className="flex flex-col gap-3"
    >
      <div>
        <h2 className="text-[15px] font-semibold">
          {labels.title}
          <span className="ml-2 text-sm font-normal text-muted">
            {number(unplaced.length)}
          </span>
        </h2>
        <p className="mt-0.5 text-[13px] text-muted">{labels.description}</p>
      </div>
      {unplaced.length === 0 ? (
        <EmptyState compact title={labels.empty} />
      ) : (
        <RunList
          runs={unplaced}
          nodes={nodes}
          focus={focus}
          expandThinking={expandThinking}
          expandTools={expandTools}
        />
      )}
    </section>
  );
}
