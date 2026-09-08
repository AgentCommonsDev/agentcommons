import { Prisma, type AgentSession, type RawRecord } from "@agentcommons/db";
import {
  NORMALIZERS,
  SourceNotReadyError,
  jsonObjectSchema,
  messageId,
  normalizerContextSchema,
  redactionContextSchema,
  repositoryIdentity,
  repositoryPath,
  searchableMessage,
  truncateUtf8,
  type SourceRecord,
} from "@agentcommons/core";
import { ServiceError } from "./context.js";

export function sourceRecord(row: RawRecord): SourceRecord {
  return {
    id: row.id,
    pos: row.pos,
    key: row.key,
    sourceVersion: row.sourceVersion,
    payload: jsonObjectSchema.parse(row.payload),
    receivedAt: row.receivedAt,
    redactionContext: redactionContextSchema.parse(row.redactionContext),
  };
}

// Ingest and policy rescans rebuild the same projection from redacted source.
// Derived IDs and counters therefore remain stable across overlap and late input.
export async function projectSession(
  tx: Prisma.TransactionClient,
  session: AgentSession,
  records: readonly SourceRecord[],
  options: { rescan?: boolean; lifecycle?: boolean } = {},
): Promise<{ ready: boolean }> {
  const normalizer = NORMALIZERS[session.harness];
  let context = normalizerContextSchema.parse(session.normalizerContext);
  let ready = true;
  const normalize = () => ({
    messages: normalizer.toMessages(records, context),
    delta: normalizer.sessionDelta(records, context),
  });
  let normalized;
  try {
    normalized = normalize();
  } catch (error) {
    if (!(error instanceof SourceNotReadyError))
      throw new ServiceError(
        422,
        "INVALID_RECORD",
        "The transcript records could not form a valid session.",
      );
    if (!options.rescan && !options.lifecycle) return { ready: false };
    ready = false;
    context = normalizerContextSchema.parse(session.projectedContext);
    try {
      normalized = normalize();
    } catch (fallbackError) {
      if (!(fallbackError instanceof SourceNotReadyError))
        throw new ServiceError(
          422,
          "INVALID_RECORD",
          "The transcript records could not form a valid session.",
        );
      // A missing historical branch must never retain a projection that predates
      // the new policy set. Preserve pending input and clear visible derivations.
      normalized = { messages: [], delta: {} };
    }
  }
  const { messages, delta } = normalized;
  const source = new Map(records.map((record) => [record.id, record]));
  const rows: Prisma.MessageCreateManyInput[] = messages.map((message, seq) => {
    const record = source.get(message.rawRecordId);
    if (!record) throw new Error("Normalized message has no source record.");
    return {
      id: messageId(session.id, record.id, message.blockIndex),
      organizationId: session.organizationId,
      sessionId: session.id,
      rawRecordId: record.id,
      blockIndex: message.blockIndex,
      seq,
      role: message.role,
      kind: message.kind,
      content: message.content,
      toolName: message.toolName,
      toolUseId: message.toolUseId,
      toolInput: message.toolInput === null ? Prisma.DbNull : message.toolInput,
      model: message.model,
      timestamp: message.timestamp,
      receivedAt: record.receivedAt,
      inputTokens: message.inputTokens,
      outputTokens: message.outputTokens,
      agentId: message.agentId,
      ...searchableMessage(message),
    };
  });
  const resumes = await tx.ingestBatch.findMany({
    where: {
      organizationId: session.organizationId,
      sessionId: session.id,
      startResume: true,
    },
    orderBy: [{ sourcePos: "asc" }, { sentAt: "asc" }, { id: "asc" }],
  });
  const positions = new Map<
    string,
    { pos: bigint; lifecycle: boolean; time: number; nativeOrder: number }
  >();
  for (const row of rows) {
    const record = row.rawRecordId ? source.get(row.rawRecordId) : undefined;
    if (!record)
      throw new Error("A projected message has no native source position.");
    positions.set(row.id, {
      pos: record.pos,
      lifecycle: false,
      time: 0,
      nativeOrder: row.seq,
    });
  }
  for (const receipt of resumes) {
    if (receipt.sourcePos === null)
      throw new Error("A resume receipt has no source position.");
    const id = messageId(session.id, `resume:${receipt.id}`, 0);
    rows.push({
      id,
      organizationId: session.organizationId,
      sessionId: session.id,
      rawRecordId: null,
      ingestBatchId: receipt.id,
      seq: 0,
      blockIndex: 0,
      role: "SYSTEM",
      kind: "META",
      content: "Session resumed.",
      toolName: null,
      toolUseId: null,
      toolInput: Prisma.DbNull,
      model: null,
      timestamp: receipt.sentAt,
      receivedAt: receipt.receivedAt,
      inputTokens: null,
      outputTokens: null,
      agentId: null,
      searchable: false,
      searchText: "",
    });
    positions.set(id, {
      pos: receipt.sourcePos,
      lifecycle: true,
      time: receipt.sentAt.getTime(),
      nativeOrder: 0,
    });
  }
  rows.sort((left, right) => {
    const a = positions.get(left.id);
    const b = positions.get(right.id);
    if (!a || !b)
      throw new Error("A projected message has no source ordering metadata.");
    return a.pos < b.pos
      ? -1
      : a.pos > b.pos
        ? 1
        : Number(a.lifecycle) - Number(b.lifecycle) ||
          a.nativeOrder - b.nativeOrder ||
          a.time - b.time ||
          left.id.localeCompare(right.id);
  });
  rows.forEach((row, seq) => {
    row.seq = seq;
  });
  await tx.embeddingState.deleteMany({
    where: { organizationId: session.organizationId, sessionId: session.id },
  });
  await tx.sessionEmbedding.deleteMany({
    where: { organizationId: session.organizationId, sessionId: session.id },
  });
  await tx.message.deleteMany({
    where: { organizationId: session.organizationId, sessionId: session.id },
  });
  // Parameter counts, rather than transcript size, bound each database statement.
  for (let start = 0; start < rows.length; start += 1000)
    await tx.message.createMany({ data: rows.slice(start, start + 1000) });
  const files = new Map<string, Set<string>>();
  for (const message of messages)
    for (const file of message.files ?? []) {
      const path = repositoryPath(file.path, session.repoRoot, session.cwd);
      if (path === null) continue;
      const operations = files.get(path) ?? new Set<string>();
      for (const operation of file.ops) operations.add(operation);
      files.set(path, operations);
    }
  await tx.sessionFile.deleteMany({
    where: { organizationId: session.organizationId, sessionId: session.id },
  });
  const fileRows = [...files].map(([path, operations]) => ({
    organizationId: session.organizationId,
    sessionId: session.id,
    path,
    ops: [...operations].sort(),
  }));
  for (let start = 0; start < fileRows.length; start += 1000)
    await tx.sessionFile.createMany({
      data: fileRows.slice(start, start + 1000),
    });
  await tx.agentSession.update({
    where: {
      organizationId_id: {
        organizationId: session.organizationId,
        id: session.id,
      },
    },
    data: {
      ...(ready ? { projectedContext: context } : {}),
      branch: delta.branch ?? session.branch,
      harnessVersion: delta.harnessVersion ?? session.harnessVersion,
      entrypoint: delta.entrypoint ?? session.entrypoint,
      model: delta.model ?? null,
      modelsUsed: delta.modelsUsed ?? [],
      startedAt: delta.startedAt ?? session.startedAt,
      title:
        delta.title === undefined
          ? null
          : Array.from(delta.title).slice(0, 120).join(""),
      firstPrompt:
        delta.firstPrompt === undefined
          ? null
          : truncateUtf8(delta.firstPrompt, 4096),
      agentType: delta.agentType ?? session.agentType,
      startCommit: session.startCommit ?? delta.startCommit ?? null,
      ...(session.repoName || !delta.repoUrl
        ? {}
        : repositoryIdentity(delta.repoUrl)),
      messageCount: rows.length,
      toolCallCount: messages.filter((message) => message.kind === "TOOL_USE")
        .length,
      toolsUsed: [
        ...new Set(
          messages.flatMap((message) =>
            message.toolName ? [message.toolName] : [],
          ),
        ),
      ].sort(),
      inputTokens: messages.reduce(
        (sum, message) => sum + (message.inputTokens ?? 0n),
        0n,
      ),
      outputTokens: messages.reduce(
        (sum, message) => sum + (message.outputTokens ?? 0n),
        0n,
      ),
    },
  });
  return { ready };
}
