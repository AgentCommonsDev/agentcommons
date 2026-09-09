import { createPolicyCache } from "./policy-cache.js";
import {
  admitUsage,
  type BillingConfiguration,
} from "../repositories/billing.js";
import { v7 as uuidv7 } from "uuid";
import {
  type Prisma,
  hasAdminAuthority,
  lockTracePublication,
  type PrismaClient,
  type TraceSessionControl,
} from "@agentcommons/db";
import {
  canonicalIdentity,
  projectionIdentity,
  redactNormalizerContext,
  endObservationStructure,
  ingestContextStructure,
  parentHintStructure,
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
  sha256Hex,
  UnpairedToolResultError,
  SourceNotReadyError,
  identityDigest,
  type SourceRecord,
  type JsonValue,
  type IngestOutput,
  type RedactionCount,
} from "@agentcommons/core";
import type { AuditService } from "./audit.js";
import { ServiceError, type ServiceContext } from "./context.js";
import { lockOrganization } from "./auth.js";
import { persistRedactionCounts } from "./policies.js";
import { mutationOperation } from "./mutation.js";
import {
  outboxRecord,
  traceOutboxPayloadSchema,
  type TraceQueue,
} from "./trace-outbox.js";

export class IngestService {
  constructor(
    private readonly dependencies: {
      prisma: PrismaClient;
      audit: AuditService;
      billing?: BillingConfiguration;
      traces: TraceQueue;
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
        const redactor = await createPolicyCache(tx).get(caller.organizationId);
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
        // The normalizer fields are redacted with identity canonicalization; the rest of
        // the context is protocol-shaped free text.
        const { activeLeafId, transcriptMetadata, ...observed } =
          envelope.context;
        const normalizerContext = await redactNormalizerContext(
          normalizerContextSchema.parse({
            ...(activeLeafId === undefined ? {} : { activeLeafId }),
            ...(transcriptMetadata === undefined ? {} : { transcriptMetadata }),
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
                ...observed,
                git: observed.git
                  ? { ...observed.git, remoteUrl: repository.repoUrl }
                  : null,
              },
              ingestContextStructure,
            )) as Record<string, JsonValue>),
            ...normalizerContext.value,
            parentHint: observed.parentHint
              ? {
                  ...((await clean(
                    observed.parentHint,
                    parentHintStructure,
                  )) as Record<string, JsonValue>),
                  harnessSessionId: await identity(
                    observed.parentHint.harnessSessionId,
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
        const nativeIdentity = projectionIdentity(nativeId);
        let session = await tx.traceSessionControl.findUnique({
          where: {
            organizationId_harness_nativeIdentity: {
              organizationId: caller.organizationId,
              harness: request.harness,
              nativeIdentity,
            },
          },
        });
        if (session?.purgedAt)
          throw new ServiceError(
            409,
            "SESSION_PURGED",
            "This session was purged and cannot accept more records.",
          );
        if (
          session &&
          session.userId !== caller.userId &&
          !hasAdminAuthority(caller)
        )
          throw new ServiceError(
            409,
            "SESSION_OWNED",
            "This session belongs to another member.",
          );
        const prior = await tx.traceReceipt.findUnique({
          where: {
            organizationId_id: {
              organizationId: caller.organizationId,
              id: request.batchId,
            },
          },
        });
        if (prior) {
          if (
            !session ||
            prior.sessionId !== session.id ||
            prior.cursor !== sha256Hex(cursor)
          )
            throw new ServiceError(
              409,
              "BATCH_CONFLICT",
              "This batch ID was already used for a different upload.",
            );
          return {
            result: ingestOutputSchema.parse({
              publication: prior.publishedAt ? "published" : "queued",
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
            organizationId: caller.organizationId,
            id: request.installationId,
            ...installation,
            hookSha256: request.hook.sha256,
            firstSeenAt: receivedAt,
            lastSeenAt: receivedAt,
          },
          update: {
            ...installation,
            hookSha256: request.hook.sha256,
            lastSeenAt: receivedAt,
          },
        });
        if (!session)
          session = await tx.traceSessionControl.create({
            data: {
              id: uuidv7(),
              organizationId: caller.organizationId,
              harness: request.harness,
              nativeIdentity,
              harnessSessionId: nativeId,
              userId: caller.userId,
              ingestApiKeyId: caller.apiKeyId,
              installationId: request.installationId,
              startedAt: receivedAt,
              lastActivityAt: receivedAt,
            },
          });
        // Every later form of a record (masked, redacted, sanitized) keeps its id, so
        // the admission identity is computed once per record.
        const identities = new Map<string, string>();
        const sourceIdentity = (record: SourceRecord): string => {
          let value = identities.get(record.id);
          if (value === undefined) {
            value = sha256Hex(
              record.key === null
                ? `position:${String(record.pos)}:${String(record.sourceVersion)}`
                : `key:${projectionIdentity(record.key)}`,
            );
            identities.set(record.id, value);
          }
          return value;
        };
        const priorSources = await tx.traceSourceAdmission.findMany({
          where: {
            organizationId: caller.organizationId,
            sessionId: session.id,
            sourceIdentity: { in: parsed.map(sourceIdentity) },
          },
          select: { sourceIdentity: true },
        });
        const seen = new Set(priorSources.map((row) => row.sourceIdentity));
        const accepted = parsed.filter((record) => {
          const key = sourceIdentity(record);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        const adapter = NORMALIZERS[request.harness];
        let masked: SourceRecord[];
        try {
          const hashes = new Set(
            accepted.flatMap((record) =>
              adapter
                .toolResults(record)
                .flatMap((result) =>
                  result.toolUseId ? [identityDigest(result.toolUseId)] : [],
                ),
            ),
          );
          const uses = adapter.toolUses(accepted);
          for (const call of uses)
            if (call.toolUseId) hashes.add(identityDigest(call.toolUseId));
          const previousCalls = await tx.traceToolCallControl.findMany({
            where: {
              organizationId: caller.organizationId,
              sessionId: session.id,
              idHash: { in: [...hashes] },
            },
          });
          masked = maskToolResults(adapter, accepted, previousCalls, uses);
          // Validate known record shapes before committing a durable receipt. A missing
          // tree leaf is a projection dependency and is retained for the next upload.
          try {
            adapter.normalize(accepted, normalizerContext.value);
          } catch (error) {
            if (!(error instanceof SourceNotReadyError)) throw error;
          }
        } catch (error) {
          if (error instanceof UnpairedToolResultError)
            throw new ServiceError(422, "UNPAIRED_TOOL_RESULT", error.message, {
              records: error.records,
            });
          throw new ServiceError(
            422,
            "INVALID_RECORD",
            "The transcript records could not form a valid session.",
            {
              records: accepted.map((record) => ({
                pos: Number(record.pos),
                key: record.key,
              })),
            },
          );
        }
        const sanitized: SourceRecord[] = [];
        for (const record of masked) {
          const redacted = await redactSourceRecord(adapter, record, redactor);
          count(redacted.counts);
          sanitized.push(sanitizeSourceRecord(redacted.value));
        }
        const position = BigInt(request.sourcePos);
        const sentAt = new Date(request.sentAt);
        const newerLifecycle =
          request.behavior !== "sync" &&
          (session.lifecyclePos === null ||
            position > session.lifecyclePos ||
            (position === session.lifecyclePos &&
              (!session.lifecycleAt || sentAt > session.lifecycleAt)));
        const newerObservation =
          session.contextPos === null ||
          position > session.contextPos ||
          (position === session.contextPos &&
            (!session.contextAt || sentAt > session.contextAt));
        const contextData = normalizerContextSchema.parse({
          ...normalizerContextSchema.parse(session.normalizerContext),
          ...(newerObservation ? normalizerContext.value : {}),
        });
        const revision = session.acceptedRevision + 1n;
        session = await tx.traceSessionControl.update({
          where: {
            organizationId_id: {
              organizationId: caller.organizationId,
              id: session.id,
            },
          },
          data: {
            acceptedRevision: revision,
            projectionState: "queued",
            normalizerContext: contextData,
            lastActivityAt: receivedAt,
            ...(newerObservation
              ? { contextPos: position, contextAt: sentAt }
              : {}),
            ...(newerLifecycle
              ? {
                  lifecyclePos: position,
                  lifecycleAt: sentAt,
                  status: request.behavior === "end" ? "ENDED" : "ACTIVE",
                  endedAt: request.behavior === "end" ? sentAt : null,
                }
              : {}),
          },
        });
        if (this.dependencies.billing)
          await admitUsage(tx, this.dependencies.billing, {
            organizationId: caller.organizationId,
            kind: "capture",
            resourceIds: sanitized.map((record) => record.id),
            receivedAt,
          });
        if (sanitized.length)
          await tx.traceSourceAdmission.createMany({
            data: sanitized.map((record) => ({
              organizationId: caller.organizationId,
              sessionId: session.id,
              sourceIdentity: sourceIdentity(record),
              rawRecordId: record.id,
              pos: record.pos,
              sourceVersion: record.sourceVersion,
              introducedRevision: revision,
              receivedAt,
            })),
          });
        // A call classified sensitive by any record stays sensitive; an existing row is
        // only ever promoted, never cleared.
        const toolCalls = new Map<string, boolean>();
        for (const record of sanitized)
          for (const call of record.redactionContext?.toolCalls ?? [])
            toolCalls.set(
              call.idHash,
              (toolCalls.get(call.idHash) ?? false) || call.sensitive,
            );
        if (toolCalls.size) {
          await tx.traceToolCallControl.createMany({
            data: [...toolCalls].map(([idHash, sensitive]) => ({
              organizationId: caller.organizationId,
              sessionId: session.id,
              idHash,
              sensitive,
            })),
            skipDuplicates: true,
          });
          const sensitive = [...toolCalls].flatMap(([idHash, flag]) =>
            flag ? [idHash] : [],
          );
          if (sensitive.length)
            await tx.traceToolCallControl.updateMany({
              where: {
                organizationId: caller.organizationId,
                sessionId: session.id,
                idHash: { in: sensitive },
              },
              data: { sensitive: true },
            });
        }
        // Spawn evidence is read before redaction so the child reference canonicalizes
        // exactly as the child's own upload does, and the call id digests to the value
        // the parent's projected `TOOL_USE` message carries (ADR 0052).
        const spawns: SpawnClaim[] = [];
        for (const spawn of adapter.spawns(accepted))
          spawns.push({
            childNativeIdentity: projectionIdentity(
              await identity(spawn.childNativeRef),
            ),
            toolUseId: projectionIdentity(spawn.toolUseId),
          });
        await lockTracePublication(tx, caller.organizationId, "write");
        const conflicts = await this.link(
          tx,
          session,
          sanitized,
          safe.context.parentHint,
          spawns,
        );
        const byteCount = incoming.reduce(
          (sum, record) => sum + Buffer.byteLength(record.line),
          0,
        );
        const redactionCount = [...counts.values()].reduce(
          (sum, item) => sum + item.count,
          0,
        );
        await tx.traceReceipt.create({
          data: {
            id: request.batchId,
            organizationId: caller.organizationId,
            sessionId: session.id,
            installationId: request.installationId,
            apiKeyId: caller.apiKeyId,
            userId: caller.userId,
            revision,
            sourcePos: position,
            sentAt,
            receivedAt,
            behavior: request.behavior,
            nativeEvent: safe.nativeEvent,
            startResume: request.start?.resume ?? false,
            lifecycleApplied: newerLifecycle,
            acceptedCount: sanitized.length,
            duplicateCount: incoming.length - sanitized.length,
            recordCount: incoming.length,
            byteCount,
            redactionCount,
            durationMs: Math.max(0, Date.now() - context.startedAt),
            cursor: sha256Hex(cursor),
          },
        });
        const outbox = await tx.traceOutbox.create({
          data: {
            id: uuidv7(),
            organizationId: caller.organizationId,
            sessionId: session.id,
            revision,
            kind: "ingest",
            payload: traceOutboxPayloadSchema.parse({
              envelope: safe,
              records: sanitized.map(outboxRecord),
              normalizerContext: contextData,
              lifecycleApplied: newerLifecycle,
              contextApplied: newerObservation,
            }),
          },
        });
        await this.dependencies.traces.enqueue(tx, {
          organizationId: caller.organizationId,
          sessionId: session.id,
          outboxId: outbox.id,
        });
        await persistRedactionCounts(
          tx,
          caller.organizationId,
          request.batchId,
          session.id,
          [...counts.values()],
        );
        return {
          result: ingestOutputSchema.parse({
            publication: "queued",
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
            publication: "queued",
            parent_conflicts: conflicts,
            owner_override: session.userId !== caller.userId,
          },
        };
      },
    );
  }
  private async link(
    tx: Prisma.TransactionClient,
    session: TraceSessionControl,
    records: readonly SourceRecord[],
    hint: Parameters<typeof resolveLink>[1],
    spawns: readonly SpawnClaim[],
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
        const parent = await tx.traceSessionControl.findUnique({
          where: {
            organizationId_harness_nativeIdentity: {
              organizationId: session.organizationId,
              harness: session.harness,
              nativeIdentity: projectionIdentity(link.parentNativeRef),
            },
          },
        });
        const cycle =
          parent !== null &&
          (await ancestorIds(tx, session.organizationId, parent.id)).includes(
            session.id,
          );
        if (!cycle)
          await tx.traceSessionControl.update({
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
    const ancestors = await ancestorIds(tx, session.organizationId, session.id);
    await tx.$executeRaw`UPDATE trace_session_control SET parent_session_id=${session.id}::uuid WHERE organization_id=${session.organizationId} AND harness=${session.harness}::"Harness" AND parent_session_id IS NULL AND public.native_identity(parent_native_ref)=${projectionIdentity(session.harnessSessionId)} AND id<>ALL(${ancestors}::uuid[])`;
    // A spawn claim names the child by the identity its own upload uses; it is kept
    // until that child exists and applies only to a child linked to this parent.
    for (const spawn of spawns) {
      if (spawn.childNativeIdentity === session.nativeIdentity) {
        conflicts.push({ spawnToolUseId: spawn.toolUseId, reason: "self" });
        continue;
      }
      await tx.traceSpawnControl.upsert({
        where: {
          organizationId_parentSessionId_childNativeIdentity: {
            organizationId: session.organizationId,
            parentSessionId: session.id,
            childNativeIdentity: spawn.childNativeIdentity,
          },
        },
        create: {
          organizationId: session.organizationId,
          parentSessionId: session.id,
          childNativeIdentity: spawn.childNativeIdentity,
          toolUseId: spawn.toolUseId,
        },
        update: { toolUseId: spawn.toolUseId },
      });
    }
    if (spawns.length) {
      const claimed = await tx.traceSessionControl.findMany({
        where: {
          organizationId: session.organizationId,
          harness: session.harness,
          nativeIdentity: {
            in: spawns.map((spawn) => spawn.childNativeIdentity),
          },
          parentSessionId: { not: null },
          NOT: { parentSessionId: session.id },
        },
        select: { nativeIdentity: true },
      });
      for (const child of claimed)
        conflicts.push({
          spawnChildNativeIdentity: child.nativeIdentity,
          reason: "other_parent",
        });
    }
    // One statement covers both arrival orders: this session's children (including the
    // waiting ones just adopted) and this session as a child that has just linked.
    await tx.$executeRaw`UPDATE trace_session_control c SET parent_tool_use_id=s.tool_use_id FROM trace_spawn_control s WHERE s.organization_id=c.organization_id AND s.parent_session_id=c.parent_session_id AND s.child_native_identity=c.native_identity AND c.organization_id=${session.organizationId} AND (c.parent_session_id=${session.id}::uuid OR c.id=${session.id}::uuid) AND c.parent_tool_use_id IS DISTINCT FROM s.tool_use_id`;
    return conflicts;
  }
}
/** A parent's spawn evidence after identity canonicalization; both fields are digests. */
interface SpawnClaim {
  childNativeIdentity: string;
  toolUseId: string;
}
/** One session and every ancestor above it, following parent links inside the organization. */
async function ancestorIds(
  tx: Prisma.TransactionClient,
  organizationId: string,
  sessionId: string,
): Promise<string[]> {
  const rows = await tx.$queryRaw<
    { id: string }[]
  >`WITH RECURSIVE ancestors(id,parent_session_id) AS (SELECT id,parent_session_id FROM trace_session_control WHERE organization_id=${organizationId} AND id=${sessionId}::uuid UNION SELECT s.id,s.parent_session_id FROM trace_session_control s JOIN ancestors a ON s.id=a.parent_session_id WHERE s.organization_id=${organizationId}) SELECT id FROM ancestors`;
  return rows.map((row) => row.id);
}
