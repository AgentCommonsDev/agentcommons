import { v7 as uuidv7 } from "uuid";
import type { Prisma, PrismaClient } from "@agentcommons/db";
import type { TokenizedInput } from "./chunker.js";

export class EmbeddingBudget {
  constructor(
    private readonly prisma: PrismaClient,
    readonly limit: number,
    private readonly price: bigint,
  ) {}
  /** The database day and row lock make the hard cap shared by all workers and searches. */
  async reserve(
    tx: Prisma.TransactionClient,
    organizationId: string,
    purpose: "index" | "query",
    inputs: readonly TokenizedInput[],
  ) {
    const dates = await tx.$queryRaw<
      { budget_day: Date }[]
    >`SELECT (now() AT TIME ZONE 'UTC')::date AS budget_day`;
    const day = dates[0]?.budget_day;
    if (!day)
      throw new Error("The database did not return its current budget day.");
    await tx.embeddingBudget.createMany({
      data: [{ organizationId, day }],
      skipDuplicates: true,
    });
    await tx.$queryRaw`SELECT organization_id FROM embedding_budget WHERE organization_id=${organizationId} AND day=${day}::date FOR UPDATE`;
    const budget = await tx.embeddingBudget.findUniqueOrThrow({
      where: { organizationId_day: { organizationId, day } },
    });
    const remaining = BigInt(this.limit) - budget.reservedTokens;
    let tokens = 0;
    let count = 0;
    for (const input of inputs) {
      if (
        BigInt(tokens + input.tokens.length) > remaining ||
        tokens + input.tokens.length > 300_000 ||
        count === 128
      )
        break;
      tokens += input.tokens.length;
      count++;
    }
    if (!count || !tokens)
      return {
        reservation: null,
        count: 0,
        deferredUntil: new Date(day.getTime() + 86_400_000),
      };
    const reservation = await tx.embeddingAttempt.create({
      data: {
        id: uuidv7(),
        organizationId,
        day,
        purpose,
        reservedTokens: tokens,
      },
    });
    await tx.embeddingBudget.update({
      where: { organizationId_day: { organizationId, day } },
      data: {
        reservedTokens: { increment: tokens },
        costNanoDollars: { increment: BigInt(tokens) * this.price },
      },
    });
    return { reservation, count, deferredUntil: null };
  }
  async finish(
    tx: Prisma.TransactionClient,
    id: string,
    tokens: number | null,
  ) {
    const attempt = await tx.embeddingAttempt.findUniqueOrThrow({
      where: { id },
    });
    if (
      tokens !== null &&
      (!Number.isSafeInteger(tokens) ||
        tokens < 0 ||
        tokens > attempt.reservedTokens)
    )
      throw new Error("The provider usage exceeds the reserved token budget.");
    const changed = await tx.embeddingAttempt.updateMany({
      where: { id, state: "reserved" },
      data: {
        state: tokens === null ? "failed" : "completed",
        actualTokens: tokens,
      },
    });
    if (changed.count && tokens !== null)
      await tx.embeddingBudget.update({
        where: {
          organizationId_day: {
            organizationId: attempt.organizationId,
            day: attempt.day,
          },
        },
        data: { actualTokens: { increment: tokens } },
      });
  }
  async status(organizationId: string) {
    const values = await this.prisma.$queryRaw<
      { tokens: bigint; cost: bigint }[]
    >`SELECT reserved_tokens tokens,cost_nano_dollars cost FROM embedding_budget WHERE organization_id=${organizationId} AND day=(now() AT TIME ZONE 'UTC')::date`;
    const cost = values[0]?.cost ?? 0n;
    return {
      embedding_daily_tokens: String(values[0]?.tokens ?? 0n),
      embedding_daily_cost: `${String(cost / 1_000_000_000n)}.${String(cost % 1_000_000_000n).padStart(9, "0")}`,
    };
  }
}
