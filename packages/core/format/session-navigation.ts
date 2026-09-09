import type { Message } from "../schemas/get.js";

const gitHosts: Readonly<Record<string, { branch: string; commit: string }>> = {
  "github.com": { branch: "tree", commit: "commit" },
  "gitlab.com": { branch: "-/tree", commit: "-/commit" },
  "bitbucket.org": { branch: "src", commit: "commits" },
};
const hasControls = (value: string) =>
  Array.from(value).some(
    (character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
  );

/** Link only recorded, credential-free repository origins and known host routes. */
export function repositoryLinks(repository: string | null) {
  if (!repository || /[\s\\]/u.test(repository) || hasControls(repository))
    return null;
  let url: URL;
  try {
    url = new URL(
      repository.includes("://") ? repository : `https://${repository}`,
    );
  } catch {
    return null;
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.hostname ||
    !url.pathname.slice(1) ||
    /%(?:2f|5c|2e)/i.test(url.pathname)
  )
    return null;
  url.protocol = "https:";
  url.pathname = url.pathname.replace(/\.git\/?$/, "").replace(/\/$/, "");
  const base = url.href.replace(/\/$/, "");
  const provider = url.port ? undefined : gitHosts[url.hostname];
  const reference = (value: string | null, kind: "branch" | "commit") =>
    provider && value && !hasControls(value)
      ? `${base}/${provider[kind]}/${encodeURIComponent(value)}`
      : null;
  return {
    repository: base,
    branch: (value: string | null) => reference(value, "branch"),
    commit: (value: string | null) => reference(value, "commit"),
  };
}

interface MessageBranch {
  message: Message;
  results: Message[];
}
/** The child-session fields a transcript needs to place a run under its spawning call. */
export interface SpawnedRun {
  session_id: string;
  parent_session_id: string | null;
  parent_tool_use_id: string | null;
}
interface SpawnPlacements<Run extends SpawnedRun> {
  /** Runs keyed by the `message_id` of the one loaded `TOOL_USE` that spawned them. */
  placed: Map<string, Run[]>;
  /** Runs whose spawning call is unknown, ambiguous, or not on a loaded page. */
  unplaced: Run[];
}
/** Loaded `TOOL_USE` messages by `tool_use_id`; a call is unambiguous when its group has one member. */
function toolCallsById(messages: readonly Message[]): Map<string, Message[]> {
  const calls = new Map<string, Message[]>();
  for (const message of messages) {
    if (message.kind !== "TOOL_USE" || !message.tool_use_id) continue;
    const group = calls.get(message.tool_use_id) ?? [];
    group.push(message);
    calls.set(message.tool_use_id, group);
  }
  return calls;
}
/** A run nests under its recorded spawning call only when exactly one loaded call has that id. */
export function spawnPlacements<Run extends SpawnedRun>(
  messages: readonly Message[],
  runs: readonly Run[],
  parentId: string,
): SpawnPlacements<Run> {
  const calls = toolCallsById(messages);
  const placed = new Map<string, Run[]>();
  const unplaced: Run[] = [];
  for (const run of runs) {
    if (run.parent_session_id !== parentId) continue;
    const matching = run.parent_tool_use_id
      ? calls.get(run.parent_tool_use_id)
      : undefined;
    const call = matching?.length === 1 ? matching[0] : undefined;
    if (!call) {
      unplaced.push(run);
      continue;
    }
    const group = placed.get(call.message_id) ?? [];
    group.push(run);
    placed.set(call.message_id, group);
  }
  return { placed, unplaced };
}

/** A recorded tool ID supports nesting only when its call is unambiguous. */
export function messageBranches(messages: readonly Message[]): MessageBranch[] {
  const calls = toolCallsById(messages);
  const results = new Map<string, Message[]>();
  const nested = new Set<string>();
  for (const message of messages) {
    if (message.kind !== "TOOL_RESULT" || !message.tool_use_id) continue;
    const matching = calls.get(message.tool_use_id);
    const call = matching?.length === 1 ? matching[0] : undefined;
    if (!call || call.seq >= message.seq) continue;
    const group = results.get(call.message_id) ?? [];
    group.push(message);
    results.set(call.message_id, group);
    nested.add(message.message_id);
  }
  return messages
    .filter((message) => !nested.has(message.message_id))
    .map((message) => ({
      message,
      results: results.get(message.message_id) ?? [],
    }));
}
