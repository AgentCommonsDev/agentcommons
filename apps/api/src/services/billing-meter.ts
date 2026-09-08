import type { Prisma, PrismaClient } from "@agentcommons/db";
import type Stripe from "stripe";
import { operatorContext } from "../auth/bootstrap.js";
import type { AuditService } from "./audit.js";

const SAFE_RETRY_MS = 23 * 60 * 60 * 1000;
const MAX_EVENT_AGE_MS = 35 * 24 * 60 * 60 * 1000;
const LEASE_MS = 60_000;

/** Durable billing delivery; transcript storage is deliberately not a dependency. */
export class BillingMeterService {
  constructor(
    private readonly dependencies: {
      prisma: PrismaClient;
      audit: AuditService;
      stripe: Stripe;
      now?: () => Date;
    },
  ) {}
  private now() {
    return this.dependencies.now?.() ?? new Date();
  }
  private async audit(
    tx: Prisma.TransactionClient,
    row: { id: string; organizationId: string },
    state: string,
  ) {
    await this.dependencies.audit.write(
      operatorContext(),
      {
        action: "billing.meter",
        resourceType: "billing_meter_event",
        resourceIds: [row.id],
        actor: {
          organizationId: row.organizationId,
          userId: null,
          apiKeyId: null,
          authMethod: "worker",
        },
        detail: { state },
      },
      tx,
    );
  }
  /** A bounded sweep is scheduled by pg-boss; independent workers share persisted leases. */
  async flush(limit = 100): Promise<void> {
    const rows = await this.dependencies.prisma.billingMeterEvent.findMany({
      where: {
        state: "pending",
        OR: [{ leaseUntil: null }, { leaseUntil: { lte: this.now() } }],
      },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      take: Math.min(100, Math.max(1, limit)),
      select: { id: true },
    });
    for (const row of rows) await this.deliver(row.id);
  }
  async deliver(id: string): Promise<void> {
    const { prisma } = this.dependencies;
    const claimed = await prisma.$transaction(async (tx) => {
      const observed = await tx.billingMeterEvent.findUnique({ where: { id } });
      if (!observed || observed.state !== "pending") return null;
      // One outstanding request per customer/meter, including other API processes.
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${observed.customerId + ":" + observed.eventName},0))`;
      const row = await tx.billingMeterEvent.findUniqueOrThrow({
        where: { id },
      });
      const now = this.now();
      if (row.state !== "pending" || (row.leaseUntil && row.leaseUntil > now))
        return null;
      if (
        (row.firstDispatchedAt &&
          now.getTime() - row.firstDispatchedAt.getTime() >= SAFE_RETRY_MS) ||
        now.getTime() - row.occurredAt.getTime() >= MAX_EVENT_AGE_MS
      ) {
        await tx.billingMeterEvent.update({
          where: { id },
          data: {
            state: "reconciliation_required",
            failureCode: "DELIVERY_WINDOW_EXCEEDED",
            leaseUntil: null,
          },
        });
        await this.audit(tx, row, "reconciliation_required");
        return null;
      }
      const other = await tx.billingMeterEvent.count({
        where: {
          id: { not: id },
          customerId: row.customerId,
          eventName: row.eventName,
          state: "pending",
          leaseUntil: { gt: now },
        },
      });
      if (other) return null;
      const leaseUntil = new Date(now.getTime() + LEASE_MS);
      await tx.billingMeterEvent.update({
        where: { id },
        data: {
          firstDispatchedAt: row.firstDispatchedAt ?? now,
          leaseUntil,
          attempts: { increment: 1 },
        },
      });
      await this.audit(tx, row, "dispatching");
      return { ...row, leaseUntil };
    });
    if (!claimed) return;
    let accepted = false;
    try {
      const response =
        await this.dependencies.stripe.billing.meterEvents.create(
          {
            event_name: claimed.eventName,
            identifier: claimed.id,
            timestamp: Math.floor(claimed.occurredAt.getTime() / 1000),
            payload: {
              stripe_customer_id: claimed.customerId,
              value: String(claimed.quantity),
            },
          },
          { idempotencyKey: claimed.id, maxNetworkRetries: 0, timeout: 10_000 },
        );
      accepted = response.identifier === claimed.id;
    } catch {
      /* Ambiguous failures retain the identical payload and identifier. */
    }
    await prisma.$transaction(async (tx) => {
      const changed = await tx.billingMeterEvent.updateMany({
        where: { id, state: "pending", leaseUntil: claimed.leaseUntil },
        data: accepted
          ? {
              state: "delivered",
              deliveredAt: this.now(),
              leaseUntil: null,
              failureCode: null,
            }
          : { leaseUntil: null, failureCode: "DELIVERY_UNCONFIRMED" },
      });
      if (changed.count)
        await this.audit(tx, claimed, accepted ? "delivered" : "retry_pending");
    });
  }
}
