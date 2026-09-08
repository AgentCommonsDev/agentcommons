import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { PrismaClient } from "@agentcommons/db";
import { startDatabase, provisionOrganization } from "./support.js";
import { startStripe } from "./stripe-support.js";
import { cleanup } from "../../../scripts/cleanup.js";
import { AuditService } from "../src/services/audit.js";
import { createPolicyCache } from "../src/services/policy-cache.js";
import { BillingMeterService } from "../src/services/billing-meter.js";
import { requireCaller } from "../src/services/context.js";

let db: Awaited<ReturnType<typeof startDatabase>>;
let stripe: Awaited<ReturnType<typeof startStripe>>;
let prisma: PrismaClient;
let audit: AuditService;
let meter: BillingMeterService;
let organizationId: string;
let now: Date;
const release: Array<() => Promise<unknown>> = [];
beforeAll(async () => {
  db = await startDatabase();
  release.unshift(() => db.close());
  stripe = await startStripe();
  release.unshift(() => stripe.close());
  organizationId = requireCaller(
    (await provisionOrganization(db, "meter-protocol")).owner,
  ).organizationId;
  prisma = new PrismaClient({ datasourceUrl: db.urls.app });
  release.unshift(() => prisma.$disconnect());
  audit = new AuditService(prisma, createPolicyCache(prisma));
  now = new Date();
  meter = new BillingMeterService({
    prisma,
    audit,
    stripe: stripe.client,
    now: () => now,
  });
});
afterAll(async () => {
  expect(await cleanup(release)).toEqual([]);
});
async function event(occurredAt = now) {
  return prisma.billingMeterEvent.create({
    data: {
      id: randomUUID(),
      organizationId,
      subscriptionId: "native_subscription",
      customerId: "cus_meter",
      kind: "capture",
      eventName: "capture_records",
      quantity: 7,
      occurredAt,
    },
  });
}
// @req R-SAAS-08
it("retries an ambiguous official SDK request with the exact identifier, payload and idempotency key", async () => {
  const row = await event();
  stripe.ambiguousMeterEvents.add(row.id);
  await meter.deliver(row.id);
  expect(
    (
      await prisma.billingMeterEvent.findUniqueOrThrow({
        where: { id: row.id },
      })
    ).state,
  ).toBe("pending");
  expect(stripe.meterEvents.get(row.id)?.payload.value).toBe("7");
  stripe.ambiguousMeterEvents.delete(row.id);
  await meter.deliver(row.id);
  const stored = await prisma.billingMeterEvent.findUniqueOrThrow({
    where: { id: row.id },
  });
  expect(stored).toMatchObject({
    state: "delivered",
    attempts: 2,
    failureCode: null,
  });
  const requests = stripe.requests.filter(
    (request) => request.body.get("identifier") === row.id,
  );
  // Official stripe-node retries a closed connection once even with maxNetworkRetries:0.
  expect(requests).toHaveLength(3);
  expect(requests.map((request) => request.idempotencyKey)).toEqual([
    row.id,
    row.id,
    row.id,
  ]);
  expect(new Set(requests.map((request) => request.body.toString())).size).toBe(
    1,
  );
  await meter.deliver(row.id);
  expect(
    stripe.requests.filter(
      (request) => request.body.get("identifier") === row.id,
    ),
  ).toHaveLength(3);
});
// @req R-SAAS-08
it("pauses ambiguous events before identifier retention expires and rejects immutable payload edits", async () => {
  const row = await event();
  stripe.ambiguousMeterEvents.add(row.id);
  await meter.deliver(row.id);
  now = new Date(now.getTime() + 23 * 3600_000);
  await meter.deliver(row.id);
  expect(
    (
      await prisma.billingMeterEvent.findUniqueOrThrow({
        where: { id: row.id },
      })
    ).state,
  ).toBe("reconciliation_required");
  expect(
    stripe.requests.filter(
      (request) => request.body.get("identifier") === row.id,
    ),
  ).toHaveLength(2);
  await expect(
    prisma.billingMeterEvent.update({
      where: { id: row.id },
      data: { quantity: 9 },
    }),
  ).rejects.toThrow("billing event payload is immutable");
  const expired = await event(new Date(now.getTime() - 36 * 86400_000));
  await meter.deliver(expired.id);
  expect(
    (
      await prisma.billingMeterEvent.findUniqueOrThrow({
        where: { id: expired.id },
      })
    ).state,
  ).toBe("reconciliation_required");
  expect(stripe.meterEvents.has(expired.id)).toBe(false);
});
// @req R-SAAS-08 @req R-AUD-01
it("serializes concurrent claims and retries safely after the delivery checkpoint audit rolls back", async () => {
  const row = await event();
  const original = audit.write.bind(audit);
  const spy = vi.spyOn(audit, "write").mockImplementation(async (...args) => {
    if (
      args[1].detail &&
      typeof args[1].detail === "object" &&
      "state" in args[1].detail &&
      args[1].detail.state === "delivered"
    )
      throw new Error("Injected billing audit failure");
    return original(...args);
  });
  await expect(meter.deliver(row.id)).rejects.toThrow(
    "Injected billing audit failure",
  );
  spy.mockRestore();
  const pending = await prisma.billingMeterEvent.findUniqueOrThrow({
    where: { id: row.id },
  });
  expect(pending.state).toBe("pending");
  now = new Date(now.getTime() + 61_000);
  await Promise.all([
    meter.deliver(row.id),
    meter.deliver(row.id),
    meter.deliver(row.id),
  ]);
  expect(
    (
      await prisma.billingMeterEvent.findUniqueOrThrow({
        where: { id: row.id },
      })
    ).state,
  ).toBe("delivered");
  expect(
    stripe.requests.filter(
      (request) => request.body.get("identifier") === row.id,
    ),
  ).toHaveLength(2);
  expect(stripe.meterEvents.get(row.id)?.payload.value).toBe("7");
});
