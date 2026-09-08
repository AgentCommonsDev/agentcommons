import { createHash } from "node:crypto";
import { posix } from "node:path";
import { v7 as uuidv7 } from "uuid";
import {
  Prisma,
  hasAdminAuthority,
  type PrismaClient,
  type AgentSession,
} from "@agentcommons/db";
import {
  canonicalIdentity,
  projectionIdentity,
  redactNormalizerContext,
  endObservationStructure,
  gitContextStructure,
  protocolLiterals,
  protocolObject,
  ingestEnvelopeSchema,
  ingestOutputSchema,
  jsonObjectSchema,
  maskToolResults,
  normalizerContextSchema,
  NORMALIZERS,
  redactSourceRecord,
  repositoryIdentity,
  resolveLink,
  sanitizeSourceRecord,
  UnpairedToolResultError,
  type SourceRecord,
  type JsonValue,
  type IngestOutput,
  type RedactionCount,
  type PolicyCache,
} from "@agentcommons/core";
import type { AuditService } from "./audit.js";
import { ServiceError, type ServiceContext } from "./context.js";
import { lockOrganization } from "./auth.js";
import { persistRedactionCounts } from "./policies.js";
import { mutationOperation } from "./mutation.js";
import { projectSession, sourceRecord } from "./projection.js";
import {
  nativeSession,
  waitingNativeChildren,
} from "../repositories/native-identity.js";

const parentHintStructure = protocolObject(
  ["harnessSessionId", "agentId", "agentType"],
  { relation: protocolLiterals("SUBAGENT", "SPAWNED") },
);
const contextStructure = protocolObject(["cwd", "activeLeafId"], {
  installation: protocolObject(["hostname", "osUser", "platform", "arch"]),
  git: gitContextStructure,
  parentHint: parentHintStructure,
  transcriptMetadata: protocolObject(["sessionId", "startTime"]),
});

const digest = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

export class IngestService {
  constructor(
    private readonly dependencies: {
      prisma: PrismaClient;
      audit: AuditService;
      policies: PolicyCache;
      embeddings?: {
        schedule(
          tx: Prisma.TransactionClient,
          data: { organizationId: string; sessionId: string },
        ): Promise<void>;
      };
    },
  ) {}

  execute(context: ServiceContext, input: unknown) {
    return mutationOperation<IngestOutput>(
      this.dependencies,
      context,
      "ingest",
      { action: "ingest", resourceType: "session", statusCode: 202 },
      async (tx, caller) => {
        const request = ingestEnvelopeSchema.parse(input);
        if (!caller.apiKeyId || caller.authMethod !== "key")
          throw new ServiceError(
            403,
            "INGEST_KEY_REQUIRED",
            "Use an organization API key to upload sessions.",
          );
        await lockOrganization(tx, caller);
        const redactor = await this.dependencies.policies.get(
          caller.organizationId,
        );
        const counts = new Map<string, RedactionCount>();
        function count(matches: RedactionCount[]) {
          for (const match of matches) {
            const current = counts.get(match.policyId);
            if (current) current.count += match.count;
            else counts.set(match.policyId, { ...match });
          }
        }
        async function clean(
          value: unknown,
          structure: Parameters<typeof redactor.json>[1] = {},
        ): Promise<JsonValue> {
          const result = await redactor.json(value, structure);
          count(result.counts);
          return result.value;
        }
        async function identity(value: string): Promise<string> {
          const result = await canonicalIdentity(value, redactor);
          count(result.counts);
          return result.value;
        }
        const nativeId = await identity(request.harnessSessionId);
        const { records: incoming, cursor, ...envelope } = request;
        const repository = repositoryIdentity(
          request.context.git?.remoteUrl ?? null,
        );
        const normalizerContext = await redactNormalizerContext(
          normalizerContextSchema.parse({
            ...(envelope.context.activeLeafId === undefined
              ? {}
              : { activeLeafId: envelope.context.activeLeafId }),
            ...(envelope.context.transcriptMetadata === undefined
              ? {}
              : { transcriptMetadata: envelope.context.transcriptMetadata }),
          }),
          redactor,
        );
        count(normalizerContext.counts);
        const safe = ingestEnvelopeSchema.parse({
          ...envelope,
          harnessSessionId: nativeId,
          nativeEvent: await clean(envelope.nativeEvent),
          context: {
            ...((await clean(
              {
                ...envelope.context,
                git: envelope.context.git
                  ? { ...envelope.context.git, remoteUrl: repository.repoUrl }
                  : null,
              },
              contextStructure,
            )) as Record<string, JsonValue>),
            ...normalizerContext.value,
            parentHint: envelope.context.parentHint
              ? {
                  ...((await clean(
                    envelope.context.parentHint,
                    parentHintStructure,
                  )) as Record<string, JsonValue>),
                  harnessSessionId: await identity(
                    envelope.context.parentHint.harnessSessionId,
                  ),
                }
              : null,
          },
          end: envelope.end
            ? await clean(envelope.end, endObservationStructure)
            : null,
          records: [],
          cursor: "",
        });
        const receivedAt = new Date();
        const parsed: SourceRecord[] = [];
        for (const record of incoming) {
          try {
            parsed.push({
              id: uuidv7(),
              pos: BigInt(record.pos),
              sourceVersion: record.sourceVersion,
              key: record.key ? await identity(record.key) : null,
              payload: jsonObjectSchema.parse(JSON.parse(record.line)),
              receivedAt,
            });
          } catch {
            throw new ServiceError(
              422,
              "INVALID_RECORD",
              "A transcript record must be a valid JSON object.",
              { records: [{ pos: record.pos, key: record.key ?? null }] },
            );
          }
        }
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`session-graph:${caller.organizationId}`},0))`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${caller.organizationId}:${request.harness}:${projectionIdentity(nativeId)}`},0))`;
        let session = await nativeSession(
          tx,
          caller.organizationId,
          request.harness,
          nativeId,
        );
        if (session) {
          await tx.$queryRaw`SELECT id FROM agent_session WHERE organization_id=${caller.organizationId} AND id=${session.id}::uuid FOR UPDATE`;
          session = await tx.agentSession.findUniqueOrThrow({
            where: {
              organizationId_id: {
                organizationId: caller.organizationId,
                id: session.id,
              },
            },
          });
          if (session.purgedAt)
            throw new ServiceError(
              409,
              "SESSION_PURGED",
              "This session was purged and cannot accept more records.",
            );
          if (session.userId !== caller.userId && !hasAdminAuthority(caller))
            throw new ServiceError(
              409,
              "SESSION_OWNED",
              "This session belongs to another member.",
            );
        }
        const prior = await tx.ingestBatch.findFirst({
          where: { organizationId: caller.organizationId, id: request.batchId },
        });
        if (prior) {
          if (
            !session ||
            prior.sessionId !== session.id ||
            prior.cursor !== digest(cursor)
          )
            throw new ServiceError(
              409,
              "BATCH_CONFLICT",
              "This batch ID was already used for a different upload.",
            );
          return {
            result: ingestOutputSchema.parse({
              sessionId: session.id,
              accepted: prior.acceptedCount,
              duplicates: prior.duplicateCount,
              cursor,
            }),
            resourceIds: [session.id],
            detail: { batch_id: prior.id, replay: true },
          };
        }
        const installation = safe.context.installation;
        await tx.installation.upsert({
          where: {
            organizationId_id: {
              organizationId: caller.organizationId,
              id: request.installationId,
            },
          },
          create: {
            ...installation,
            organizationId: caller.organizationId,
            id: request.installationId,
            firstSeenAt: receivedAt,
            lastSeenAt: receivedAt,
          },
          update: { ...installation, lastSeenAt: receivedAt },
        });
        if (!session)
          session = await tx.agentSession.create({
            data: {
              id: uuidv7(),
              organizationId: caller.organizationId,
              harness: request.harness,
              harnessSessionId: nativeId,
              userId: caller.userId,
              ingestApiKeyId: caller.apiKeyId,
              installationId: request.installationId,
              cwd: safe.context.cwd,
              repoRoot: safe.context.git?.root ?? null,
              cwdRelative: safe.context.git
                ? posix.relative(safe.context.git.root, safe.context.cwd)
                : null,
              repoName: safe.context.git?.remoteUrl ?? null,
              repoUrl: safe.context.git?.remoteUrl ?? null,
              branch: safe.context.git?.branch ?? null,
              startCommit: safe.context.git?.head ?? null,
              startedAt: receivedAt,
              lastActivityAt: receivedAt,
            },
          });
        const existingRows = await tx.rawRecord.findMany({
          where: {
            organizationId: caller.organizationId,
            sessionId: session.id,
          },
          orderBy: [{ pos: "asc" }, { sourceVersion: "asc" }],
        });
        const existing = existingRows.map(sourceRecord);
        const seenKeys = new Set(
          existing.flatMap((record) =>
            record.key === null ? [] : [projectionIdentity(record.key)],
          ),
        );
        const seenPositions = new Set(
          existing.flatMap((record) =>
            record.key === null
              ? [`${String(record.pos)}:${String(record.sourceVersion)}`]
              : [],
          ),
        );
        const accepted = parsed.filter((record) => {
          const position = `${String(record.pos)}:${String(record.sourceVersion)}`;
          if (record.key !== null) {
            const identity = projectionIdentity(record.key);
            if (seenKeys.has(identity)) return false;
            seenKeys.add(identity);
          } else {
            if (seenPositions.has(position)) return false;
            seenPositions.add(position);
          }
          return true;
        });
        let masked: SourceRecord[];
        try {
          masked = maskToolResults(
            NORMALIZERS[request.harness],
            accepted,
            existing,
          );
        } catch (error) {
          if (error instanceof UnpairedToolResultError)
            throw new ServiceError(422, "UNPAIRED_TOOL_RESULT", error.message, {
              records: error.records,
            });
          throw error;
        }
        const sanitized: SourceRecord[] = [];
        for (const record of masked) {
          const redacted = await redactSourceRecord(
            NORMALIZERS[request.harness],
            record,
            redactor,
          );
          count(redacted.counts);
          sanitized.push(sanitizeSourceRecord(redacted.value));
        }
        const all = [...existing, ...sanitized];
        const position = BigInt(request.sourcePos);
        const sentAt = new Date(request.sentAt);
        const newerLifecycle =
          request.behavior !== "sync" &&
          (position > session.lifecyclePos ||
            (position === session.lifecyclePos &&
              (!session.lifecycleAt || sentAt > session.lifecycleAt)));
        // Source drains have upload timestamps; lifecycle receipts retain native
        // event timestamps. A later drain must not suppress an earlier-captured end.
        const observed = await tx.ingestBatch.findFirst({
          where: {
            organizationId: caller.organizationId,
            sessionId: session.id,
            sourcePos: { not: null },
          },
          orderBy: [{ sourcePos: "desc" }, { sentAt: "desc" }],
          select: { sourcePos: true, sentAt: true },
        });
        const newerObservation =
          !observed ||
          observed.sourcePos === null ||
          position > observed.sourcePos ||
          (position === observed.sourcePos && sentAt > observed.sentAt);
        const contextData = normalizerContextSchema.parse({
          ...normalizerContextSchema.parse(session.normalizerContext),
          ...(newerObservation
            ? {
                ...(safe.context.activeLeafId === undefined
                  ? {}
                  : { activeLeafId: safe.context.activeLeafId }),
                ...(safe.context.transcriptMetadata === undefined
                  ? {}
                  : { transcriptMetadata: safe.context.transcriptMetadata }),
              }
            : {}),
        });
        const contextChanged =
          JSON.stringify(contextData) !==
          JSON.stringify(session.normalizerContext);
        session = await tx.agentSession.update({
          where: {
            organizationId_id: {
              organizationId: caller.organizationId,
              id: session.id,
            },
          },
          data: {
            lastActivityAt: receivedAt,
            normalizerContext: contextData,
            ...(newerLifecycle
              ? {
                  lifecyclePos: position,
                  lifecycleAt: sentAt,
                  ...(request.behavior === "end"
                    ? {
                        status: "ENDED",
                        endedAt: sentAt,
                        endReason: safe.end?.reason ?? null,
                        endCommit: safe.end?.head ?? null,
                        observedCommits:
                          safe.end?.observedCommits ?? Prisma.DbNull,
                        observedDiffStat:
                          safe.end?.observedDiffStat ?? Prisma.DbNull,
                        dirtyFileCount: safe.end?.dirtyFileCount ?? null,
                      }
                    : request.behavior === "start"
                      ? { status: "ACTIVE", endedAt: null, endReason: null }
                      : {}),
                }
              : {}),
          },
        });
        const byteCount = incoming.reduce(
          (sum, record) => sum + Buffer.byteLength(record.line),
          0,
        );
        const redactionCount = [...counts.values()].reduce(
          (sum, item) => sum + item.count,
          0,
        );
        await tx.ingestBatch.create({
          data: {
            id: request.batchId,
            organizationId: caller.organizationId,
            sessionId: session.id,
            apiKeyId: caller.apiKeyId,
            userId: caller.userId,
            installationId: request.installationId,
            ip: context.ip ?? "unknown",
            userAgent:
              context.userAgent === null
                ? null
                : (await redactor.text(context.userAgent)).value,
            cursor: digest(cursor),
            acceptedCount: sanitized.length,
            sourcePos: position,
            sentAt,
            behavior: request.behavior,
            startResume: request.start?.resume ?? false,
            lifecycleApplied: newerLifecycle,
            nativeEvent: safe.nativeEvent,
            receivedAt,
            recordCount: incoming.length,
            duplicateCount: incoming.length - sanitized.length,
            byteCount,
            redactionCount,
            durationMs: Math.max(0, Date.now() - context.startedAt),
          },
        });
        for (const record of sanitized)
          await tx.rawRecord.create({
            data: {
              organizationId: caller.organizationId,
              id: record.id,
              sessionId: session.id,
              pos: record.pos,
              sourceVersion: record.sourceVersion,
              key: record.key,
              recordType:
                typeof record.payload.type === "string"
                  ? record.payload.type
                  : "unknown",
              payload: jsonObjectSchema.parse(record.payload),
              redactionContext: record.redactionContext ?? {},
              ingestBatchId: request.batchId,
              receivedAt,
            },
          });
        let projectionReady = true;
        if (sanitized.length || contextChanged || request.start?.resume) {
          try {
            projectionReady = (
              await projectSession(tx, session, all, {
                lifecycle: request.start?.resume ?? false,
              })
            ).ready;
            await this.dependencies.embeddings?.schedule(tx, {
              organizationId: caller.organizationId,
              sessionId: session.id,
            });
          } catch (error) {
            if (error instanceof ServiceError && error.statusCode === 422)
              throw new ServiceError(422, error.code, error.message, {
                records: incoming.map((record) => ({
                  pos: record.pos,
                  key: record.key ?? null,
                })),
              });
            throw error;
          }
        }
        const conflicts = await this.link(
          tx,
          session,
          all,
          safe.context.parentHint,
        );
        await persistRedactionCounts(
          tx,
          caller.organizationId,
          request.batchId,
          session.id,
          [...counts.values()],
        );
        return {
          result: ingestOutputSchema.parse({
            sessionId: session.id,
            accepted: sanitized.length,
            duplicates: incoming.length - sanitized.length,
            cursor,
          }),
          resourceIds: [session.id],
          detail: {
            batch_id: request.batchId,
            accepted: sanitized.length,
            duplicates: incoming.length - sanitized.length,
            redactions: redactionCount,
            projection_ready: projectionReady,
            parent_conflicts: conflicts,
            owner_override: session.userId !== caller.userId,
          },
        };
      },
    );
  }

  private async link(
    tx: Prisma.TransactionClient,
    session: AgentSession,
    records: readonly SourceRecord[],
    hint: Parameters<typeof resolveLink>[1],
  ): Promise<JsonValue[]> {
    const { link, conflicts } = resolveLink(
      NORMALIZERS[session.harness].links(records),
      hint,
    );
    if (link) {
      if (
        session.parentNativeRef &&
        (projectionIdentity(session.parentNativeRef) !==
          projectionIdentity(link.parentNativeRef) ||
          session.parentRelation !== link.relation)
      )
        conflicts.push({
          parentNativeRef: link.parentNativeRef,
          relation: link.relation,
        });
      else if (
        projectionIdentity(link.parentNativeRef) !==
        projectionIdentity(session.harnessSessionId)
      ) {
        const parent = await nativeSession(
          tx,
          session.organizationId,
          session.harness,
          link.parentNativeRef,
        );
        let cycle = false;
        if (parent) {
          const ancestors = await tx.$queryRaw<
            { id: string }[]
          >`WITH RECURSIVE ancestors(id,parent_session_id) AS (SELECT id,parent_session_id FROM agent_session WHERE organization_id=${session.organizationId} AND id=${parent.id}::uuid UNION SELECT s.id,s.parent_session_id FROM agent_session s JOIN ancestors a ON s.id=a.parent_session_id WHERE s.organization_id=${session.organizationId}) SELECT id FROM ancestors WHERE id=${session.id}::uuid`;
          cycle = ancestors.length > 0;
        }
        if (!cycle)
          await tx.agentSession.update({
            where: {
              organizationId_id: {
                organizationId: session.organizationId,
                id: session.id,
              },
            },
            data: {
              parentNativeRef: link.parentNativeRef,
              parentRelation: link.relation,
              parentSessionId: parent?.id ?? null,
              ...(link.agentType ? { agentType: link.agentType } : {}),
            },
          });
        else
          conflicts.push({
            parentNativeRef: link.parentNativeRef,
            reason: "cycle",
          });
      } else
        conflicts.push({
          parentNativeRef: link.parentNativeRef,
          reason: "self",
        });
    }
    // Resolve only explicit waiting edges. Visibility is applied when reading, so
    // a private parent never needs to be copied into a child's public fields.
    const ancestors = await tx.$queryRaw<
      { id: string }[]
    >`WITH RECURSIVE ancestors(id,parent_session_id) AS (SELECT id,parent_session_id FROM agent_session WHERE organization_id=${session.organizationId} AND id=${session.id}::uuid UNION SELECT s.id,s.parent_session_id FROM agent_session s JOIN ancestors a ON s.id=a.parent_session_id WHERE s.organization_id=${session.organizationId}) SELECT id FROM ancestors`;
    const waiting = await waitingNativeChildren(
      tx,
      session.organizationId,
      session.harness,
      session.harnessSessionId,
    );
    await tx.agentSession.updateMany({
      where: {
        organizationId: session.organizationId,
        harness: session.harness,
        parentSessionId: null,
        id: {
          in: waiting.map((child) => child.id),
          notIn: ancestors.map((ancestor) => ancestor.id),
        },
      },
      data: { parentSessionId: session.id },
    });
    return conflicts;
  }
}
