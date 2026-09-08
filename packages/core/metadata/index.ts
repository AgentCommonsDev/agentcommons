import { posix } from "node:path";
import { v5 } from "uuid";
import type { NormalizedMessage, NativeLink } from "../normalizers/types.js";
import type { JsonValue } from "../schemas/common.js";
import { utf8ByteLength } from "../schemas/common.js";
import { projectionIdentity } from "../redaction/tool-results.js";

export function utf8Slice(
  value: string,
  offset: number,
  maximumBytes: number,
): { content: string; nextOffset: number | null } {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes < 0
  )
    throw new Error("Use nonnegative UTF-8 byte offsets and limits.");
  let position = 0;
  let used = 0;
  let content = "";
  for (const character of value) {
    const bytes = utf8ByteLength(character);
    if (position < offset) {
      position += bytes;
      if (position > offset)
        throw new Error("The cursor must point to a UTF-8 character boundary.");
      continue;
    }
    if (used + bytes > maximumBytes)
      return { content, nextOffset: offset + used };
    content += character;
    used += bytes;
    position += bytes;
  }
  if (offset > position)
    throw new Error("The cursor is past the end of the message.");
  return { content, nextOffset: null };
}

export function truncateUtf8(value: string, maximumBytes: number): string {
  return utf8Slice(value, 0, maximumBytes).content;
}

function tailUtf8(value: string, maximumBytes: number): string {
  let bytes = 0;
  let start = value.length;
  for (let index = value.length - 1; index >= 0; index--) {
    const low = value.charCodeAt(index);
    const paired =
      low >= 0xdc00 &&
      low <= 0xdfff &&
      index > 0 &&
      value.charCodeAt(index - 1) >= 0xd800 &&
      value.charCodeAt(index - 1) <= 0xdbff;
    const character = value.slice(paired ? index - 1 : index, index + 1);
    const size = utf8ByteLength(character);
    if (bytes + size > maximumBytes) break;
    bytes += size;
    if (paired) index--;
    start = index;
  }
  return value.slice(start);
}

export function searchableMessage(
  message: Pick<
    NormalizedMessage,
    "kind" | "content" | "toolName" | "toolInput"
  >,
): { searchable: boolean; searchText: string } {
  switch (message.kind) {
    case "TEXT":
      return { searchable: true, searchText: message.content };
    case "TOOL_USE":
      return {
        searchable: true,
        searchText:
          `${message.toolName ?? ""} ${truncateUtf8(JSON.stringify(message.toolInput), 1024)}`.trim(),
      };
    case "TOOL_RESULT":
      return {
        searchable: true,
        searchText:
          utf8ByteLength(message.content) <= 4096
            ? message.content
            : `${truncateUtf8(message.content, 2048)}\n…\n${tailUtf8(message.content, 2048)}`,
      };
    default:
      return { searchable: false, searchText: "" };
  }
}

export function messageId(
  sessionId: string,
  rawRecordId: string,
  blockIndex: number,
): string {
  return v5(`${rawRecordId}:${String(blockIndex)}`, sessionId);
}

export function repositoryIdentity(remote: string | null): {
  repoName: string | null;
  repoUrl: string | null;
} {
  if (!remote) return { repoName: null, repoUrl: null };
  const scp = /^(?:[^@/]+@)?([^/:]+):([^/].*)$/.exec(remote);
  try {
    const url = new URL(
      scp && !remote.includes("://")
        ? `ssh://${scp[1] ?? ""}/${scp[2] ?? ""}`
        : remote,
    );
    if (!["http:", "https:", "ssh:", "git:"].includes(url.protocol))
      return { repoName: null, repoUrl: null };
    const path = url.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "");
    if (!url.hostname || !path) return { repoName: null, repoUrl: null };
    const canonical = `${url.host.toLowerCase()}/${path}`;
    return { repoName: canonical, repoUrl: canonical };
  } catch {
    return { repoName: null, repoUrl: null };
  }
}

export function repositoryPath(
  path: string,
  root: string | null,
  cwd: string,
): string | null {
  if (!root) return null;
  const absolute = posix.resolve(cwd, path);
  const relative = posix.relative(root, absolute);
  return relative === ".." || relative.startsWith("../") ? null : relative;
}

export interface ParentHint {
  harnessSessionId: string;
  relation: "SUBAGENT" | "SPAWNED";
  agentType?: string | null | undefined;
}
export function resolveLink(
  native: readonly NativeLink[],
  hint: ParentHint | null,
): {
  link: {
    parentNativeRef: string;
    relation: "SUBAGENT" | "FORK" | "SPAWNED";
    agentType?: string;
  } | null;
  conflicts: JsonValue[];
} {
  const first = native[0];
  const link =
    first ??
    (hint
      ? {
          parentNativeRef: hint.harnessSessionId,
          relation: hint.relation,
          ...(hint.agentType ? { agentType: hint.agentType } : {}),
        }
      : null);
  const conflicts: JsonValue[] = [];
  for (const candidate of [
    ...native.slice(1),
    ...(first && hint
      ? [{ parentNativeRef: hint.harnessSessionId, relation: hint.relation }]
      : []),
  ]) {
    if (
      !link ||
      projectionIdentity(candidate.parentNativeRef) !==
        projectionIdentity(link.parentNativeRef) ||
      candidate.relation !== link.relation
    )
      conflicts.push({
        parentNativeRef: candidate.parentNativeRef,
        relation: candidate.relation,
      });
  }
  return { link, conflicts };
}
