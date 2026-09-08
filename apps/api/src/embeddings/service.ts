import { createHash } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@agentcommons/db";
import type { PolicyCache } from "@agentcommons/core";
import { requirePermission, type ServiceContext } from "../services/context.js";
import { operatorContext } from "../auth/bootstrap.js";
import type { AuditService } from "../services/audit.js";
import {
  chunks,
  sessionInput,
  tokenPrefix,
  tokenize,
  type TokenizedInput,
} from "./chunker.js";
import { EmbeddingBudget } from "./budget.js";
import { EMBEDDING_DIMENSIONS, type EmbeddingProvider } from "./provider.js";

export const embeddingJobSchema = z.strictObject({
  organizationId: z.string().min(1),
  sessionId: z.uuid(),
});
export type EmbeddingJob = z.infer<typeof embeddingJobSchema>;
interface Target {
  id: string;
  kind: "message" | "session";
  input: TokenizedInput;
}
interface Dependencies {
  prisma: PrismaClient;
  provider: EmbeddingProvider;
  audit: AuditService;
  policies: PolicyCache;
  dailyTokenBudget: number;
}
export class EmbeddingService {
  readonly budget: EmbeddingBudget;
  constructor(private readonly dependencies: Dependencies) {
    if (dependencies.provider.dimensions !== EMBEDDING_DIMENSIONS)
      throw new Error(
        "The embedding provider dimensions do not match the database migration.",
      );
    this.budget = new EmbeddingBudget(
      dependencies.prisma,
      dependencies.dailyTokenBudget,
      dependencies.provider.nanoDollarsPerToken,
    );
  }
  async initialize() {
    const { provider, prisma } = this.dependencies;
    await prisma.$transaction(async (tx) => {
      const inserted = await tx.embeddingDeployment.createMany({
        data: [
          {
            id: 1,
            provider: provider.name,
            model: provider.model,
            dimensions: provider.dimensions,
          },
        ],
        skipDuplicates: true,
      });
      if (inserted.count)
        await this.dependencies.audit.write(
          operatorContext(),
          {
            action: "embeddings.configure",
            detail: {
              provider: provider.name,
              model: provider.model,
              dimensions: provider.dimensions,
            },
          },
          tx,
        );
      const current = await tx.embeddingDeployment.findUniqueOrThrow({
        where: { id: 1 },
      });
      if (
        current.provider !== provider.name ||
        current.model !== provider.model ||
        current.dimensions !== provider.dimensions
      )
        throw new Error(
          "The embedding deployment changed. Migrate its derived vectors before enabling the new provider or model.",
        );
    });
  }
  private async source(tx: Prisma.TransactionClient, data: EmbeddingJob) {
    const session = await tx.agentSession.findUnique({
      where: {
        organizationId_id: {
          organizationId: data.organizationId,
          id: data.sessionId,
        },
      },
    });
    if (!session || session.purgedAt) return null;
    this.dependencies.policies.invalidate(data.organizationId);
    const redactor = await this.dependencies.policies.get(data.organizationId);
    const policyRevision = await tx.redactionPolicy.findMany({
      where: { organizationId: data.organizationId },
      select: { id: true, updatedAt: true },
      orderBy: { id: "asc" },
    });
    const messages = await tx.message.findMany({
      where: {
        organizationId: data.organizationId,
        sessionId: data.sessionId,
        searchable: true,
      },
      orderBy: { seq: "asc" },
      select: { id: true, seq: true, searchText: true },
    });
    for (const message of messages)
      message.searchText = (await redactor.text(message.searchText)).value;
    const lastReply = await tx.message.findFirst({
      where: {
        organizationId: data.organizationId,
        sessionId: data.sessionId,
        role: "ASSISTANT",
        kind: "TEXT",
      },
      orderBy: { seq: "desc" },
      select: { content: true },
    });
    const files = await tx.sessionFile.findMany({
      where: { organizationId: data.organizationId, sessionId: data.sessionId },
      orderBy: { path: "asc" },
      select: { path: true },
    });
    const rawSummary = sessionInput({
      title: session.title,
      firstPrompt: session.firstPrompt,
      lastReply: lastReply?.content ?? "",
      files: files.map((file) => file.path),
    });
    const summary = tokenPrefix(
      (await redactor.text(rawSummary.content)).value,
      8191,
    );
    const digest = createHash("sha256")
      .update(
        JSON.stringify({
          provider: this.dependencies.provider.name,
          model: this.dependencies.provider.model,
          messages,
          policyRevision,
          summary: summary.content,
        }),
      )
      .digest("hex");
    return { messages, summary, digest, redactor };
  }
  private async lock(tx: Prisma.TransactionClient, data: EmbeddingJob) {
    const rows = await tx.$queryRaw<
      { now: Date }[]
    >`SELECT clock_timestamp() AS now FROM agent_session WHERE organization_id=${data.organizationId} AND id=${data.sessionId}::uuid FOR UPDATE`;
    return rows[0]?.now ?? new Date();
  }
  /** One delivery makes at most one provider call; pending vectors are durable checkpoints. */
  async process({
    organizationId,
    sessionId,
  }: EmbeddingJob): Promise<{ complete: boolean; deferredUntil: Date | null }> {
    const data = { organizationId, sessionId };
    const { prisma, provider, audit } = this.dependencies;
    const plan = await prisma.$transaction(
      async (tx) => {
        const prepare = async () => {
          const now = await this.lock(tx, data);
          const source = await this.source(tx, data);
          if (!source) return null;
          let state = await tx.embeddingState.findUnique({
            where: { organizationId_sessionId: data },
          });
          if (state?.leaseUntil && state.leaseUntil.getTime() > now.getTime())
            return { wait: state.leaseUntil };
          if (!state || state.sourceDigest !== source.digest) {
            await tx.messageChunk.deleteMany({ where: data });
            await tx.sessionEmbedding.deleteMany({ where: data });
            const rows = [];
            for (const message of source.messages) {
              let ordinal = 0;
              for (const input of chunks(message.searchText)) {
                const clean = (await source.redactor.text(input.content)).value;
                for (const part of chunks(clean))
                  rows.push({
                    organizationId: data.organizationId,
                    sessionId: data.sessionId,
                    id: uuidv7(),
                    messageId: message.id,
                    ordinal: ordinal++,
                    content: part.content,
                    tokenCount: part.tokens.length,
                    model: provider.model,
                  });
              }
            }
            for (let offset = 0; offset < rows.length; offset += 500)
              await tx.messageChunk.createMany({
                data: rows.slice(offset, offset + 500),
              });
            await tx.sessionEmbedding.create({
              data: {
                ...data,
                model: provider.model,
                tokenCount: source.summary.tokens.length,
              },
            });
            state = await tx.embeddingState.upsert({
              where: { organizationId_sessionId: data },
              create: { ...data, sourceDigest: source.digest },
              update: {
                sourceDigest: source.digest,
                complete: false,
                leaseToken: null,
                leaseUntil: null,
              },
            });
          }
          if (state.complete) return null;
          const pending = await tx.$queryRaw<
            { id: string; content: string }[]
          >`SELECT id,content FROM message_chunk WHERE organization_id=${data.organizationId} AND session_id=${data.sessionId}::uuid AND embedding IS NULL ORDER BY message_id,ordinal LIMIT 128`;
          const targets: Target[] = pending.map((row) => ({
            id: row.id,
            kind: "message",
            input: tokenize(row.content),
          }));
          if (targets.length < 128) {
            const session = await tx.$queryRaw<
              { session_id: string }[]
            >`SELECT session_id FROM session_embedding WHERE organization_id=${data.organizationId} AND session_id=${data.sessionId}::uuid AND embedding IS NULL`;
            if (session.length)
              targets.push({
                id: data.sessionId,
                kind: "session",
                input: source.summary,
              });
          }
          if (!targets.length) {
            await tx.embeddingState.update({
              where: { organizationId_sessionId: data },
              data: { complete: true },
            });
            return null;
          }
          const reserved = await this.budget.reserve(
            tx,
            data.organizationId,
            "index",
            targets.map((target) => target.input),
          );
          if (!reserved.reservation) return { wait: reserved.deferredUntil };
          const lease = uuidv7();
          await tx.$executeRaw`UPDATE embedding_state SET lease_token=${lease}::uuid,lease_until=clock_timestamp()+interval '90 seconds',updated_at=clock_timestamp() WHERE organization_id=${data.organizationId} AND session_id=${data.sessionId}::uuid`;
          return {
            targets: targets.slice(0, reserved.count),
            reservation: reserved.reservation,
            digest: source.digest,
            lease,
          };
        };
        const prepared = await prepare();
        await audit.write(
          operatorContext(),
          {
            action: "embeddings.reserve",
            resourceType: "session",
            resourceIds: [data.sessionId],
            actor: {
              organizationId: data.organizationId,
              userId: null,
              apiKeyId: null,
              authMethod: "worker",
            },
            detail: {
              state: !prepared
                ? "unchanged"
                : "wait" in prepared
                  ? "deferred"
                  : "reserved",
              tokens:
                prepared && "reservation" in prepared
                  ? prepared.reservation.reservedTokens
                  : 0,
            },
          },
          tx,
        );
        return prepared;
      },
      { timeout: 120_000, maxWait: 30_000 },
    );
    if (!plan) return { complete: true, deferredUntil: null };
    if ("wait" in plan) return { complete: false, deferredUntil: plan.wait };
    let result: { vectors: number[][]; tokens: number };
    try {
      result = await provider.embed(plan.targets.map((target) => target.input));
      z.object({
        vectors: z
          .array(z.array(z.number()).length(provider.dimensions))
          .length(plan.targets.length),
        tokens: z.number().int().min(0).max(plan.reservation.reservedTokens),
      }).parse(result);
      if (result.vectors.some((vector) => Math.hypot(...vector) === 0))
        throw new Error("The embedding provider returned a zero vector.");
    } catch {
      await prisma.$transaction(async (tx) => {
        await this.lock(tx, data);
        await this.budget.finish(tx, plan.reservation.id, null);
        await tx.embeddingState.updateMany({
          where: { ...data, leaseToken: plan.lease },
          data: { leaseToken: null, leaseUntil: null },
        });
        await audit.write(
          operatorContext(),
          {
            action: "embeddings.index",
            statusCode: 502,
            resourceType: "session",
            resourceIds: [data.sessionId],
            actor: {
              organizationId: data.organizationId,
              userId: null,
              apiKeyId: null,
              authMethod: "worker",
            },
            detail: { failed: true },
          },
          tx,
        );
      });
      throw new Error("The embedding provider request failed.");
    }
    return prisma.$transaction(
      async (tx) => {
        await this.lock(tx, data);
        await this.budget.finish(tx, plan.reservation.id, result.tokens);
        const source = await this.source(tx, data);
        const state = await tx.embeddingState.findUnique({
          where: { organizationId_sessionId: data },
        });
        const stale =
          !source ||
          source.digest !== plan.digest ||
          state?.leaseToken !== plan.lease;
        if (!stale)
          for (const [index, target] of plan.targets.entries()) {
            const vector = result.vectors[index];
            if (!vector)
              throw new Error("The embedding result is missing a vector.");
            const literal = `[${vector.join(",")}]`;
            if (target.kind === "message")
              await tx.$executeRaw`UPDATE message_chunk SET embedding=${literal}::vector WHERE organization_id=${data.organizationId} AND session_id=${data.sessionId}::uuid AND id=${target.id}::uuid`;
            else
              await tx.$executeRaw`UPDATE session_embedding SET embedding=${literal}::vector,updated_at=now() WHERE organization_id=${data.organizationId} AND session_id=${data.sessionId}::uuid`;
          }
        const pending = await tx.$queryRaw<
          { pending: boolean }[]
        >`SELECT EXISTS(SELECT 1 FROM message_chunk WHERE organization_id=${data.organizationId} AND session_id=${data.sessionId}::uuid AND embedding IS NULL) OR EXISTS(SELECT 1 FROM session_embedding WHERE organization_id=${data.organizationId} AND session_id=${data.sessionId}::uuid AND embedding IS NULL) pending`;
        const complete = !stale && pending[0]?.pending === false;
        await tx.embeddingState.updateMany({
          where: { ...data, leaseToken: plan.lease },
          data: { complete, leaseToken: null, leaseUntil: null },
        });
        await audit.write(
          operatorContext(),
          {
            action: "embeddings.index",
            resourceType: "session",
            resourceIds: [data.sessionId],
            actor: {
              organizationId: data.organizationId,
              userId: null,
              apiKeyId: null,
              authMethod: "worker",
            },
            detail: {
              vectors: stale ? 0 : plan.targets.length,
              stale,
              complete,
            },
          },
          tx,
        );
        return { complete: !source || complete, deferredUntil: null };
      },
      { timeout: 120_000, maxWait: 30_000 },
    );
  }
  /** Search falls back to lexical ranking when its shared daily budget is exhausted. */
  async query(context: ServiceContext, text: string): Promise<number[] | null> {
    const { organizationId } = requirePermission(context, "read");
    const redactor = await this.dependencies.policies.get(organizationId);
    const input = tokenPrefix((await redactor.text(text)).value, 8191);
    if (!input.tokens.length) return null;
    const reserved = await this.dependencies.prisma.$transaction(async (tx) => {
      const value = await this.budget.reserve(tx, organizationId, "query", [
        input,
      ]);
      await this.dependencies.audit.write(
        context,
        {
          action: "embeddings.query.reserve",
          resourceType: "query",
          detail: {
            tokens: value.reservation?.reservedTokens ?? 0,
            deferred: !value.reservation,
          },
        },
        tx,
      );
      return value;
    });
    if (!reserved.reservation) return null;
    try {
      const response = await this.dependencies.provider.embed([input]);
      const vector = z
        .array(z.number())
        .length(this.dependencies.provider.dimensions)
        .parse(response.vectors[0]);
      if (Math.hypot(...vector) === 0)
        throw new Error("The embedding provider returned a zero vector.");
      await this.dependencies.prisma.$transaction(async (tx) => {
        await this.budget.finish(tx, reserved.reservation.id, response.tokens);
        await this.dependencies.audit.write(
          context,
          {
            action: "embeddings.query.complete",
            resourceType: "query",
            detail: { tokens: response.tokens },
          },
          tx,
        );
      });
      return vector;
    } catch {
      await this.dependencies.prisma.$transaction(async (tx) => {
        await this.budget.finish(tx, reserved.reservation.id, null);
        await this.dependencies.audit.write(
          context,
          {
            action: "embeddings.query.complete",
            resourceType: "query",
            statusCode: 502,
            detail: { fallback: true },
          },
          tx,
        );
      });
      return null;
    }
  }
}
