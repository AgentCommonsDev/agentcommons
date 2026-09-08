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

/** A recorded tool ID supports nesting only when its call is unambiguous. */
export function messageBranches(messages: readonly Message[]): MessageBranch[] {
  const calls = new Map<string, Message[]>();
  for (const message of messages) {
    if (message.kind !== "TOOL_USE" || !message.tool_use_id) continue;
    const group = calls.get(message.tool_use_id) ?? [];
    group.push(message);
    calls.set(message.tool_use_id, group);
  }
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
