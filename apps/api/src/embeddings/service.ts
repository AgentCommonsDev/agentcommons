import { lockTracePublication, lockTraceSink } from "@agentcommons/db";
import {
  EMBEDDING_DIMENSIONS,
  type TraceRepository,
  type TraceEmbeddingChunk,
  type TraceScope,
} from "@agentcommons/traces";
import {
  admitUsage,
  type BillingConfiguration,
} from "../repositories/billing.js";
import { organizationEmbeddingSetting } from "./settings.js";
import { createPolicyCache } from "../services/policy-cache.js";
import { createHash } from "node:crypto";
import { v7 as uuidv7, v5 as uuidv5 } from "uuid";
import { z } from "zod";
import type {
  Prisma,
  PrismaClient,
  TraceSessionControl,
} from "@agentcommons/db";
import type { PolicyCache } from "@agentcommons/core";
import { requirePermission, type ServiceContext } from "../services/context.js";
import { operatorContext, workerActor } from "../auth/bootstrap.js";
import type { AuditService } from "../services/audit.js";
import {
  chunks,
  sessionInput,
  tokenPrefix,
  tokenize,
  type TokenizedInput,
} from "./chunker.js";
import { EmbeddingBudget } from "./budget.js";
import type { EmbeddingProvider } from "./provider.js";

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
  traces: TraceRepository;
  billing?: BillingConfiguration;
}
/** The parts of an indexing plan that publication checks against the live rows. */
interface PublicationPlan {
  settingsRevision: number;
  lease: string;
  source: {
    scope: Pick<TraceScope, "revision" | "generation">;
    policyDigest: string;
  };
}
export class EmbeddingService {
  readonly budget: EmbeddingBudget;
  private readonly saas: boolean;
  constructor(private readonly dependencies: Dependencies) {
    if (dependencies.provider.dimensions !== EMBEDDING_DIMENSIONS)
      throw new Error(
        "The embedding provider dimensions do not match the database migration.",
      );
    this.saas = dependencies.billing?.mode === "saas";
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
    const control = await tx.traceSessionControl.findUnique({
      where: {
        organizationId_id: {
          organizationId: data.organizationId,
          id: data.sessionId,
        },
      },
    });
    if (!control || control.purgedAt || control.publishedRevision === 0n)
      return null;
    const scope = {
      ...data,
      revision: control.publishedRevision,
      generation: control.redactionGeneration,
    };
    const header = await this.dependencies.traces.readSession(
      data.organizationId,
      data.sessionId,
      scope.revision,
      scope.generation,
    );
    if (!header) return null;
    const redactor = await createPolicyCache(tx).get(data.organizationId);
    const policyDigest = await this.policyDigest(tx, data.organizationId);
    const messages = [];
    let after: string | null = null;
    do {
      const page = await this.dependencies.traces.messagesPage(scope, {
        after,
        limit: 1000,
      });
      messages.push(...page.items);
      after = page.after;
    } while (after);
    messages.sort((left, right) => left.seq - right.seq);
    const files: string[] = [];
    do {
      const page = await this.dependencies.traces.projectionManifest(
        scope,
        "files",
        { after, limit: 1000 },
      );
      files.push(...page.items.map((item) => item.id));
      after = page.after;
    } while (after);
    const summary = tokenPrefix(
      (
        await redactor.text(
          sessionInput({
            title: header.title,
            firstPrompt: header.first_prompt,
            lastReply:
              [...messages]
                .reverse()
                .find(
                  (message) =>
                    message.role === "ASSISTANT" && message.kind === "TEXT",
                )?.content ?? "",
            files,
          }).content,
        )
      ).value,
      8191,
    );
    const desired: Array<Omit<TraceEmbeddingChunk, "embedding">> = [];
    for (const message of messages.filter((message) => message.searchable)) {
      let ordinal = 0;
      const clean = (await redactor.text(message.search_text)).value;
      for (const part of chunks(clean)) {
        const contentHash = createHash("sha256")
          .update(part.content)
          .digest("hex");
        desired.push({
          id: uuidv5(
            `${providerIdentity(this.dependencies.provider)}:${String(ordinal)}:${contentHash}`,
            message.id,
          ),
          messageId: message.id,
          ordinal: ordinal++,
          content: part.content,
          contentHash,
          tokenCount: part.tokens.length,
          model: this.dependencies.provider.model,
        });
      }
    }
    const digest = createHash("sha256")
      .update(
        JSON.stringify({
          scope: {
            revision: String(scope.revision),
            generation: String(scope.generation),
          },
          policyDigest,
          model: providerIdentity(this.dependencies.provider),
          chunks: desired.map((row) => row.id),
          summary: summary.content,
        }),
      )
      .digest("hex");
    return {
      scope,
      desired,
      summary,
      digest,
      policyDigest,
    };
  }
  private async policyDigest(
    tx: Prisma.TransactionClient,
    organizationId: string,
  ) {
    return JSON.stringify(
      await tx.redactionPolicy.findMany({
        where: { organizationId },
        select: { id: true, updatedAt: true },
        orderBy: { id: "asc" },
      }),
    );
  }
  private async lock(tx: Prisma.TransactionClient, data: EmbeddingJob) {
    const rows = await tx.$queryRaw<
      { now: Date }[]
    >`SELECT clock_timestamp() AS now FROM trace_session_control WHERE organization_id=${data.organizationId} AND id=${data.sessionId}::uuid FOR UPDATE`;
    return rows[0]?.now ?? new Date();
  }
  /** One audit row for a worker step on the session, inside the caller's transaction. */
  private workerAudit(
    tx: Prisma.TransactionClient,
    data: EmbeddingJob,
    action: string,
    detail: unknown,
    statusCode?: number,
  ) {
    return this.dependencies.audit.write(
      operatorContext(),
      {
        action,
        resourceType: "session",
        resourceIds: [data.sessionId],
        actor: workerActor(data.organizationId),
        detail,
        ...(statusCode === undefined ? {} : { statusCode }),
      },
      tx,
    );
  }
  /**
   * Whether the source, lease or organization setting a plan was built from has moved
   * since: the session was purged or republished, the policies or setting changed, or
   * another worker took the lease.
   */
  private async stale(
    tx: Prisma.TransactionClient,
    plan: PublicationPlan,
    data: EmbeddingJob,
    setting: { enabled: boolean; revision: number },
  ): Promise<{ stale: boolean; current: TraceSessionControl | null }> {
    const current = await tx.traceSessionControl.findUnique({
      where: {
        organizationId_id: {
          organizationId: data.organizationId,
          id: data.sessionId,
        },
      },
    });
    const state = await tx.embeddingState.findUnique({
      where: { organizationId_sessionId: data },
    });
    const stale =
      !setting.enabled ||
      setting.revision !== plan.settingsRevision ||
      !current ||
      current.purgedAt !== null ||
      current.publishedRevision !== plan.source.scope.revision ||
      current.redactionGeneration !== plan.source.scope.generation ||
      state?.leaseToken !== plan.lease ||
      (await this.policyDigest(tx, data.organizationId)) !==
        plan.source.policyDigest;
    return { stale, current };
  }
  /** One provider batch; ClickHouse keeps completed vectors behind the publication fence. */
  async process(
    data: EmbeddingJob,
  ): Promise<{ complete: boolean; deferredUntil: Date | null }> {
    const { prisma, provider, traces } = this.dependencies;
    const { saas } = this;
    const plan = await prisma.$transaction(
      async (tx) => {
        const setting = await organizationEmbeddingSetting(
          tx,
          data.organizationId,
          true,
          saas,
        );
        if (!setting.enabled) return null;
        const now = await this.lock(tx, data);
        const state = await tx.embeddingState.findUnique({
          where: { organizationId_sessionId: data },
        });
        if (state?.leaseUntil && state.leaseUntil > now)
          return { wait: state.leaseUntil };
        const source = await this.source(tx, data);
        if (!source) return null;
        source.digest = createHash("sha256")
          .update(`${source.digest}:${String(setting.revision)}`)
          .digest("hex");
        let vectorRevision = state?.vectorRevision;
        if (!state || state.sourceDigest !== source.digest) {
          const rows = await tx.$queryRaw<
            { revision: bigint }[]
          >`SELECT nextval('embedding_state_vector_revision_seq') AS revision`;
          vectorRevision = rows[0]?.revision;
        }
        if (vectorRevision === undefined)
          throw new Error("The vector revision could not be allocated.");
        const vectorScope = { ...source.scope, revision: vectorRevision };
        const cached = new Map<string, TraceEmbeddingChunk>();
        let after: string | null = null;
        do {
          const page = await traces.embeddingsPage(vectorScope, {
            after,
            limit: 1000,
          });
          for (const row of page.items) cached.set(row.id, row);
          after = page.after;
        } while (after);
        const complete = source.desired.flatMap((row) => {
          const previous = cached.get(row.id);
          return previous &&
            previous.contentHash === row.contentHash &&
            previous.model === row.model
            ? [{ ...row, embedding: previous.embedding }]
            : [];
        });
        const storedSession = await traces.readSessionEmbedding(vectorScope);
        const session =
          storedSession?.model === provider.model ? storedSession : null;
        const completeIds = new Set(complete.map((row) => row.id));
        const targets: Target[] = source.desired
          .filter((row) => !completeIds.has(row.id))
          .slice(0, 128)
          .map((row) => ({
            id: row.id,
            kind: "message",
            input: tokenize(row.content),
          }));
        if (targets.length < 128 && !session)
          targets.push({
            id: data.sessionId,
            kind: "session",
            input: source.summary,
          });
        const reservation = targets.length
          ? await this.budget.reserve(
              tx,
              data.organizationId,
              "index",
              targets.map((target) => target.input),
            )
          : null;
        await this.workerAudit(tx, data, "embeddings.reserve", {
          tokens: reservation?.reservation?.reservedTokens ?? 0,
        });
        if (reservation && !reservation.reservation)
          return { wait: reservation.deferredUntil };
        const lease = uuidv7();
        await tx.embeddingState.upsert({
          where: { organizationId_sessionId: data },
          create: {
            ...data,
            sourceDigest: source.digest,
            vectorRevision,
            leaseToken: lease,
            leaseUntil: new Date(Date.now() + 90_000),
          },
          update: {
            sourceDigest: source.digest,
            vectorRevision,
            complete: false,
            leaseToken: lease,
            leaseUntil: new Date(Date.now() + 90_000),
          },
        });
        return {
          source: { ...source, complete, session },
          vectorScope,
          targets: targets.slice(0, reservation?.count ?? targets.length),
          reservation: reservation?.reservation ?? null,
          lease,
          settingsRevision: setting.revision,
        };
      },
      { timeout: 120_000, maxWait: 30_000 },
    );
    if (!plan) return { complete: true, deferredUntil: null };
    if ("wait" in plan) return { complete: false, deferredUntil: plan.wait };
    let result: { vectors: number[][]; tokens: number } = {
      vectors: [],
      tokens: 0,
    };
    try {
      if (plan.targets.length) {
        result = await provider.embed(
          plan.targets.map((target) => target.input),
        );
        z.object({
          vectors: z
            .array(z.array(z.number()).length(provider.dimensions))
            .length(plan.targets.length),
          tokens: z
            .number()
            .int()
            .min(0)
            .max(plan.reservation?.reservedTokens ?? 0),
        }).parse(result);
        if (result.vectors.some((vector) => Math.hypot(...vector) === 0))
          throw new Error("The embedding provider returned a zero vector.");
      }
    } catch (error) {
      await prisma.$transaction(async (tx) => {
        if (plan.reservation)
          await this.budget.finish(tx, plan.reservation.id, null);
        await tx.embeddingState.updateMany({
          where: { ...data, leaseToken: plan.lease },
          data: { leaseToken: null, leaseUntil: null },
        });
        await this.workerAudit(
          tx,
          data,
          "embeddings.index",
          { failed: true },
          502,
        );
      });
      throw new Error("The embedding provider request failed.", {
        cause: error,
      });
    }
    const reservation = plan.reservation;
    if (reservation)
      await prisma.$transaction(async (tx) => {
        await this.budget.finish(tx, reservation.id, result.tokens);
        await this.workerAudit(tx, data, "embeddings.provider.complete", {
          tokens: result.tokens,
        });
      });
    const completed = new Map(plan.source.complete.map((row) => [row.id, row]));
    const desired = new Map(plan.source.desired.map((row) => [row.id, row]));
    let summary = plan.source.session;
    for (const [index, target] of plan.targets.entries()) {
      const vector = result.vectors[index];
      if (!vector) throw new Error("The embedding result is missing a vector.");
      if (target.kind === "session")
        summary = {
          model: provider.model,
          tokenCount: plan.source.summary.tokens.length,
          embedding: vector,
          updatedAt: new Date(),
        };
      else {
        const row = desired.get(target.id);
        if (!row) throw new Error("The embedding target is missing.");
        completed.set(row.id, { ...row, embedding: vector });
      }
    }
    try {
      const written = await prisma.$transaction(
        async (tx) => {
          await lockTraceSink(tx, data.organizationId, data.sessionId, "read");
          const setting = await organizationEmbeddingSetting(
            tx,
            data.organizationId,
            false,
            saas,
          );
          if ((await this.stale(tx, plan, data, setting)).stale) return false;
          await traces.writeEmbeddings(plan.vectorScope, {
            chunks: [...completed.values()],
            session: summary,
            updatedAt: new Date(),
          });
          return true;
        },
        { timeout: 120_000, maxWait: 10_000 },
      );
      return await prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM organization WHERE id=${data.organizationId} FOR NO KEY UPDATE`;
          await lockTracePublication(tx, data.organizationId, "write");
          const setting = await organizationEmbeddingSetting(
            tx,
            data.organizationId,
            true,
            saas,
          );
          await this.lock(tx, data);
          const { stale: moved, current } = await this.stale(
            tx,
            plan,
            data,
            setting,
          );
          const stale = !written || moved;
          const complete =
            !stale &&
            completed.size === plan.source.desired.length &&
            summary !== null;
          if (complete) {
            if (this.dependencies.billing)
              await admitUsage(tx, this.dependencies.billing, {
                organizationId: data.organizationId,
                kind: "embedding",
                resourceIds: [
                  ...new Set(plan.source.desired.map((row) => row.messageId)),
                ],
                receivedAt: new Date(),
              });
            await tx.traceSessionControl.update({
              where: {
                organizationId_id: {
                  organizationId: data.organizationId,
                  id: data.sessionId,
                },
              },
              data: {
                embeddingRevision: plan.vectorScope.revision,
                embeddingSourceRevision: plan.source.scope.revision,
              },
            });
          }
          await tx.embeddingState.updateMany({
            where: { ...data, leaseToken: plan.lease },
            data: { complete, leaseToken: null, leaseUntil: null },
          });
          await this.workerAudit(tx, data, "embeddings.index", {
            vectors: stale ? 0 : plan.targets.length,
            stale,
            complete,
          });
          return {
            complete:
              !setting.enabled ||
              !current ||
              Boolean(current.purgedAt) ||
              complete,
            deferredUntil: null,
          };
        },
        { timeout: 120_000, maxWait: 10_000 },
      );
    } catch (error) {
      await prisma.$transaction(async (tx) => {
        await tx.embeddingState.updateMany({
          where: { ...data, leaseToken: plan.lease },
          data: { leaseToken: null, leaseUntil: null },
        });
        await this.workerAudit(
          tx,
          data,
          "embeddings.index",
          { retry: true },
          503,
        );
      });
      throw new Error("Embedding publication must retry.", { cause: error });
    }
  }
  /** Search falls back to lexical ranking when its shared daily budget is exhausted. */
  async query(context: ServiceContext, text: string): Promise<number[] | null> {
    const { organizationId } = requirePermission(context, "read");
    if (
      !(
        await organizationEmbeddingSetting(
          this.dependencies.prisma,
          organizationId,
          false,
          this.saas,
        )
      ).enabled
    )
      return null;
    const redactor = await this.dependencies.policies.get(organizationId);
    const input = tokenPrefix((await redactor.text(text)).value, 8191);
    if (!input.tokens.length) return null;
    const reserved = await this.dependencies.prisma.$transaction(async (tx) => {
      const setting = await organizationEmbeddingSetting(
        tx,
        organizationId,
        true,
        this.saas,
      );
      if (!setting.enabled) return null;
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
      return { ...value, settingsRevision: setting.revision };
    });
    if (!reserved?.reservation) return null;
    try {
      const response = await this.dependencies.provider.embed([input]);
      const vector = z
        .array(z.number())
        .length(this.dependencies.provider.dimensions)
        .parse(response.vectors[0]);
      if (Math.hypot(...vector) === 0)
        throw new Error("The embedding provider returned a zero vector.");
      const current = await this.dependencies.prisma.$transaction(
        async (tx) => {
          const setting = await organizationEmbeddingSetting(
            tx,
            organizationId,
            true,
            this.saas,
          );
          await this.budget.finish(
            tx,
            reserved.reservation.id,
            response.tokens,
          );
          await this.dependencies.audit.write(
            context,
            {
              action: "embeddings.query.complete",
              resourceType: "query",
              detail: { tokens: response.tokens },
            },
            tx,
          );
          return (
            setting.enabled && setting.revision === reserved.settingsRevision
          );
        },
      );
      return current ? vector : null;
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

function providerIdentity(provider: EmbeddingProvider) {
  return `${provider.name}:${provider.model}`;
}
