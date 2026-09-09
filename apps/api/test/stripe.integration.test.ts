import { startTraceDatabase } from "../../../packages/traces/test/support.js";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { startStripe } from "./stripe-support.js";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { billingUsageSchema, billingRedirectSchema } from "@agentcommons/core";
import { requireCaller, type ServiceContext } from "../src/services/context.js";
import { startApp, type StartedApp } from "./app.js";
import {
  injectHeaders,
  provisionOrganization,
  provisionMember,
  releaser,
  testAuthConfiguration,
} from "./support.js";

let db: Awaited<ReturnType<typeof startTraceDatabase>>;
let runtime: StartedApp["runtime"];
let app: StartedApp["app"];
let sdk: Stripe;
const signingSecret = "whsec_local_protocol_fixture";
const { defer, release } = releaser();
let stripe: Awaited<ReturnType<typeof startStripe>>;
// Every `/auth/*` request counts against the in-memory `auth` rate category (20 per
// minute per IP, apps/api/src/routes/rate-limit.ts), so each test speaks from its own IP.
let clientIndex = 0;
let clientIp = "10.30.0.1";
beforeEach(() => {
  clientIp = `10.30.0.${String(++clientIndex)}`;
});
function event(type: string, object: unknown, id = `evt_${randomUUID()}`) {
  return {
    id,
    object: "event",
    type,
    created: Math.floor(Date.now() / 1000),
    data: { object },
  };
}
function signedHeader(options: {
  payload: string;
  secret: string;
  timestamp?: number;
}) {
  return sdk.webhooks.generateTestHeaderString({
    timestamp: Math.floor(Date.now() / 1000),
    scheme: "v1",
    signature: "",
    cryptoProvider: Stripe.createNodeCryptoProvider(),
    ...options,
  });
}
async function send(
  value: ReturnType<typeof event>,
  options: { signature?: string; payload?: string } = {},
) {
  const payload = options.payload ?? JSON.stringify(value, null, 2);
  const signature =
    options.signature ?? signedHeader({ payload, secret: signingSecret });
  return app.inject({
    method: "POST",
    url: "/auth/stripe/webhook",
    headers: {
      "content-type": "application/json",
      "stripe-signature": signature,
    },
    payload,
    remoteAddress: clientIp,
  });
}
async function account(name: string) {
  const customer = `cus_${randomUUID()}`;
  const org = await provisionOrganization(db, `stripe-${name}`, {
    verified: true,
    stripeCustomerId: customer,
  });
  return {
    ...org,
    customer,
    organizationId: requireCaller(org.owner).organizationId,
  };
}
async function stored(id: string) {
  return db.prisma.subscription.findFirstOrThrow({
    where: { stripeSubscriptionId: id },
  });
}
async function finance(
  context: ServiceContext,
  action: "checkout" | "portal",
  payload: Record<string, unknown> = action === "checkout"
    ? { plan: "pro" }
    : {},
) {
  return app.inject({
    method: "POST",
    url: `/api/v1/billing/${action}`,
    headers: injectHeaders(context),
    payload,
  });
}

beforeAll(async () => {
  stripe = await startStripe();
  sdk = stripe.client;
  defer(stripe.close);
  db = await startTraceDatabase();
  defer(() => db.close());
  const started = await startApp(
    db,
    { INSTANCE_MODE: "saas" },
    {
      configure: (env) => ({
        ...env,
        auth: {
          ...testAuthConfiguration,
          instanceMode: "saas",
          stripe: {
            client: sdk,
            webhookSecret: signingSecret,
            ...stripe.billing,
          },
        },
      }),
    },
  );
  defer(() => started.close());
  ({ runtime, app } = started);
}, 120_000);
afterAll(async () => {
  vi.restoreAllMocks();
  await release();
});

// @req R-SAAS-05
it("accepts a genuine raw-body SDK signature without browser Origin and scopes paid native state and audit to its customer organization", async () => {
  const org = await account("signed");
  const native = stripe.subscription(`sub_${randomUUID()}`, org.customer);
  stripe.current.set(native.id, native);
  const receipt = event("customer.subscription.created", native);
  const response = await send(receipt);
  expect(response.statusCode, response.body).toBe(200);
  expect(await stored(native.id)).toMatchObject({
    referenceId: org.organizationId,
    status: "active",
    plan: "pro",
  });
  expect((await runtime.services.billing.usage(org.owner)).result.plan).toBe(
    "pro",
  );
  const audit = await db.prisma.auditEvent.findFirstOrThrow({
    where: { organizationId: org.organizationId, action: "billing.webhook" },
  });
  expect(audit).toMatchObject({
    authMethod: "stripe",
    userId: null,
    statusCode: 200,
  });
  expect(audit.detail).toMatchObject({
    event_id: receipt.id,
    event_type: receipt.type,
  });
});

// @req R-SAAS-05
it("rejects missing, tampered and stale signatures before native state or Stripe retrieval", async () => {
  const org = await account("signatures");
  const native = stripe.subscription(`sub_${randomUUID()}`, org.customer);
  stripe.current.set(native.id, native);
  const value = event("customer.subscription.created", native);
  const payload = JSON.stringify(value);
  const initial = stripe.requests.length;
  const signature = signedHeader({
    payload,
    secret: signingSecret,
  });
  for (const options of [
    { signature: "" },
    { signature, payload: `${payload} ` },
    {
      signature: signedHeader({
        payload: JSON.stringify(value, null, 2),
        secret: signingSecret,
        timestamp: 1,
      }),
    },
  ]) {
    const response = await send(value, options);
    expect(response.statusCode, response.body).toBe(400);
  }
  expect(stripe.requests).toHaveLength(initial);
  expect(
    await db.prisma.subscription.count({
      where: { referenceId: org.organizationId },
    }),
  ).toBe(0);
});

// @req R-SAAS-05
it.each([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "checkout.session.completed",
])(
  "rolls back %s on remote failure and accepts the identical signed retry",
  async (type) => {
    const org = await account(type.replaceAll(".", "-"));
    const native = stripe.subscription(`sub_${randomUUID()}`, org.customer);
    stripe.current.set(native.id, native);
    if (type !== "customer.subscription.created") {
      expect(
        (await send(event("customer.subscription.created", native))).statusCode,
      ).toBe(200);
    }
    const before = await db.prisma.subscription.findFirst({
      where: { stripeSubscriptionId: native.id },
    });
    const latest = { ...native, status: "canceled" };
    stripe.current.set(native.id, latest);
    const object =
      type === "checkout.session.completed"
        ? {
            id: `cs_${randomUUID()}`,
            object: "checkout.session",
            mode: "subscription",
            customer: org.customer,
            subscription: native.id,
            client_reference_id: org.organizationId,
            metadata: {
              subscriptionId: before?.id,
              referenceId: org.organizationId,
            },
          }
        : latest;
    const receipt = event(type, object);
    stripe.unavailable.add(native.id);
    const failed = await send(receipt);
    expect(failed.statusCode, failed.body).toBe(400);
    expect(
      await db.prisma.subscription.findFirst({
        where: { stripeSubscriptionId: native.id },
      }),
    ).toEqual(before);
    const failure = await db.prisma.auditEvent.findFirstOrThrow({
      where: {
        organizationId: org.organizationId,
        action: "billing.webhook",
        statusCode: { gte: 400 },
      },
    });
    expect(failure.detail).toMatchObject({
      event_id: receipt.id,
      event_type: type,
    });
    stripe.unavailable.delete(native.id);
    const retried = await send(receipt);
    expect(retried.statusCode, retried.body).toBe(200);
    expect(await stored(native.id)).toMatchObject({
      status: "canceled",
      referenceId: org.organizationId,
    });
    expect(
      await db.prisma.subscription.count({
        where: { stripeSubscriptionId: native.id },
      }),
    ).toBe(1);
    expect((await runtime.services.billing.usage(org.owner)).result.plan).toBe(
      "free",
    );
  },
);

// @req R-SAAS-05
it("serializes duplicate deliveries and reconciles a delayed active event against current canceled Stripe state", async () => {
  const org = await account("ordering");
  const native = stripe.subscription(`sub_${randomUUID()}`, org.customer);
  stripe.current.set(native.id, native);
  const created = event("customer.subscription.created", native);
  const responses = await Promise.all(
    Array.from({ length: 3 }, () => send(created)),
  );
  expect(responses.map((response) => response.statusCode)).toEqual([
    200, 200, 200,
  ]);
  expect(
    await db.prisma.subscription.count({
      where: { stripeSubscriptionId: native.id },
    }),
  ).toBe(1);
  const canceled = { ...native, status: "canceled" };
  stripe.current.set(native.id, canceled);
  expect(
    (await send(event("customer.subscription.updated", canceled))).statusCode,
  ).toBe(200);
  const stale = {
    ...event("customer.subscription.updated", native),
    created: created.created - 3600,
  };
  expect((await send(stale)).statusCode).toBe(200);
  expect(await stored(native.id)).toMatchObject({ status: "canceled" });
  expect((await runtime.services.billing.usage(org.owner)).result.plan).toBe(
    "free",
  );
});

// @req R-SAAS-05
it("rolls back native paid state when its mandatory audit cannot persist", async () => {
  const org = await account("audit-rollback");
  const native = stripe.subscription(`sub_${randomUUID()}`, org.customer);
  stripe.current.set(native.id, native);
  const receipt = event("customer.subscription.created", native);
  const fault = vi
    .spyOn(runtime.services.audit, "write")
    .mockRejectedValueOnce(new Error("Forced audit storage failure"));
  try {
    const response = await send(receipt);
    expect(response.statusCode).toBeGreaterThanOrEqual(500);
  } finally {
    fault.mockRestore();
  }
  expect(
    await db.prisma.subscription.count({
      where: { stripeSubscriptionId: native.id },
    }),
  ).toBe(0);
  expect((await send(receipt)).statusCode).toBe(200);
  expect(
    await db.prisma.subscription.count({
      where: { stripeSubscriptionId: native.id },
    }),
  ).toBe(1);
});

// @req R-SAAS-06
it("binds native checkout and portal to the owner organization, published price and fixed return URL without granting paid access on redirect", async () => {
  const org = await account("finance");
  const initial = stripe.requests.length;
  const response = await finance(org.owner, "checkout");
  expect(response.statusCode, response.body).toBe(200);
  expect(billingRedirectSchema.parse(response.json()).url).toBe(
    "https://checkout.stripe.com/c/pay/cs_test_protocol",
  );
  const checkout = stripe.requests
    .slice(initial)
    .find((request) => request.path === "/v1/checkout/sessions");
  expect(checkout?.body.get("customer")).toBe(org.customer);
  expect(checkout?.body.get("client_reference_id")).toBe(org.organizationId);
  expect(checkout?.body.get("line_items[0][price]")).toBe("price_pro");
  expect(checkout?.body.get("line_items[0][quantity]")).toBe("1");
  expect(checkout?.body.get("cancel_url")).toBe(
    `${testAuthConfiguration.publicUrl}/app/billing`,
  );
  const success = new URL(z.string().parse(checkout?.body.get("success_url")));
  expect(success.origin).toBe(testAuthConfiguration.publicUrl);
  expect(success.pathname).toBe("/auth/subscription/success");
  expect(success.searchParams.get("callbackURL")).toBe(
    `${testAuthConfiguration.publicUrl}/app/billing`,
  );
  const usage = await app.inject({
    method: "GET",
    url: "/api/v1/billing",
    headers: injectHeaders(org.owner),
  });
  expect(billingUsageSchema.parse(usage.json())).toMatchObject({
    plan: "free",
    can_manage: true,
    portal_enabled: true,
  });
  const beforeReturn = stripe.requests.length;
  const returned = await app.inject({
    method: "GET",
    url: "/auth/subscription/success?checkoutSessionId=forged&callbackURL=https%3A%2F%2Fevil.example",
    remoteAddress: clientIp,
  });
  expect(returned.statusCode).toBe(303);
  expect(returned.headers.location).toBe(
    `${testAuthConfiguration.publicUrl}/app/billing`,
  );
  expect(stripe.requests).toHaveLength(beforeReturn);
  expect((await runtime.services.billing.usage(org.owner)).result.plan).toBe(
    "free",
  );
  const portal = await finance(org.owner, "portal");
  expect(portal.statusCode, portal.body).toBe(200);
  expect(billingRedirectSchema.parse(portal.json()).url).toBe(
    "https://billing.stripe.com/p/session/test_protocol",
  );
  const portalRequest = stripe.requests.at(-1);
  expect(portalRequest?.path).toBe("/v1/billing_portal/sessions");
  expect(portalRequest?.body.get("customer")).toBe(org.customer);
  expect(portalRequest?.body.get("return_url")).toBe(
    `${testAuthConfiguration.publicUrl}/app/billing`,
  );
});

// @req R-SAAS-06
it("rejects member, API-key and forged finance bodies before contacting Stripe", async () => {
  const org = await account("authority");
  const member = await provisionMember(
    db,
    org.owner,
    "stripe-finance-member@example.com",
    { verified: true },
  );
  const initial = stripe.requests.length;
  for (const actor of [member.owner, member.context, org.context]) {
    for (const action of ["checkout", "portal"] as const) {
      const response = await finance(actor, action);
      expect(response.statusCode, response.body).toBe(403);
    }
  }
  for (const body of [
    { referenceId: "another-organization" },
    { plan: "enterprise" },
    { returnUrl: "https://evil.example" },
  ]) {
    expect((await finance(org.owner, "checkout", body)).statusCode).toBe(400);
  }
  const direct = await app.inject({
    method: "POST",
    url: "/auth/subscription/upgrade",
    headers: injectHeaders(org.owner),
    payload: { plan: "pro", referenceId: org.organizationId },
    remoteAddress: clientIp,
  });
  expect(direct.statusCode).toBe(404);
  expect(stripe.requests).toHaveLength(initial);
});

// @req R-SAAS-06
it("refuses misconfigured Stripe prices before creating a checkout session", async () => {
  const org = await account("price");
  const original = stripe.price;
  const initial = stripe.requests.filter(
    (request) => request.path === "/v1/checkout/sessions",
  ).length;
  try {
    for (const invalid of [
      { ...original, active: false },
      { ...original, currency: "eur" },
      { ...original, unit_amount: 9999 },
      { ...original, recurring: { ...original.recurring, interval: "year" } },
      { ...original, recurring: { ...original.recurring, interval_count: 2 } },
      {
        ...original,
        recurring: { ...original.recurring, usage_type: "metered" },
      },
    ]) {
      stripe.price = invalid;
      const response = await finance(org.owner, "checkout");
      expect(response.statusCode, response.body).toBe(503);
      expect(response.json()).toMatchObject({
        code: "BILLING_PRICE_MISMATCH",
      });
    }
  } finally {
    stripe.price = original;
  }
  expect(
    stripe.requests.filter(
      (request) => request.path === "/v1/checkout/sessions",
    ),
  ).toHaveLength(initial);
});

// @req R-SAAS-06
it("creates the first native Stripe organization customer and retains its identity on a repeated checkout", async () => {
  const org = await account("new-customer");
  await db.prisma.organization.update({
    where: { id: org.organizationId },
    data: { stripeCustomerId: null },
  });
  const before = stripe.customers.size;
  const response = await finance(org.owner, "checkout");
  expect(response.statusCode, response.body).toBe(200);
  const saved = await db.prisma.organization.findUniqueOrThrow({
    where: { id: org.organizationId },
  });
  const customer = stripe.customers.get(
    z.string().parse(saved.stripeCustomerId),
  );
  expect(customer?.metadata).toMatchObject({
    organizationId: org.organizationId,
    customerType: "organization",
  });
  expect(stripe.customers.size).toBe(before + 1);
  expect((await finance(org.owner, "checkout")).statusCode).toBe(200);
  expect(stripe.customers.size).toBe(before + 1);
});

// @req R-SAAS-05
it.each(
  [
    "customer.subscription.created",
    "customer.subscription.updated",
    "checkout.session.completed",
  ].flatMap((type) => [
    { type, status: "active", priceId: "price_unconfigured" },
    { type, status: "canceled", priceId: "price_pro" },
  ]),
)(
  "reconciles $type to current $status/$priceId without retaining stale Pro",
  async ({ type, status, priceId }) => {
    const org = await account(`changed-${type.replaceAll(".", "-")}-${status}`);
    const native = stripe.subscription(`sub_${randomUUID()}`, org.customer);
    stripe.current.set(native.id, native);
    expect(
      (await send(event("customer.subscription.created", native))).statusCode,
    ).toBe(200);
    expect((await runtime.services.billing.usage(org.owner)).result.plan).toBe(
      "pro",
    );
    const changed = stripe.subscription(
      native.id,
      org.customer,
      status,
      priceId,
    );
    stripe.current.set(native.id, changed);
    const saved = await stored(native.id);
    const object =
      type === "checkout.session.completed"
        ? {
            id: `cs_${randomUUID()}`,
            object: "checkout.session",
            mode: "subscription",
            customer: org.customer,
            subscription: native.id,
            client_reference_id: org.organizationId,
            metadata: {
              subscriptionId: saved.id,
              referenceId: org.organizationId,
            },
          }
        : native;
    const response = await send(event(type, object));
    expect(response.statusCode, response.body).toBe(200);
    expect((await runtime.services.billing.usage(org.owner)).result.plan).toBe(
      "free",
    );
    if (status === "active") {
      stripe.current.set(native.id, native);
      const restored = await send(event(type, object));
      expect(restored.statusCode, restored.body).toBe(200);
      expect(
        (await runtime.services.billing.usage(org.owner)).result.plan,
      ).toBe("pro");
    }
  },
);

// @req R-SAAS-06
it("sends existing paid owners to the portal and keeps browser finance protected by Origin", async () => {
  const org = await account("existing-paid");
  const native = stripe.subscription(`sub_${randomUUID()}`, org.customer);
  stripe.current.set(native.id, native);
  expect(
    (await send(event("customer.subscription.created", native))).statusCode,
  ).toBe(200);
  const initial = stripe.requests.length;
  const checkout = await finance(org.owner, "checkout");
  expect(checkout.statusCode).toBe(409);
  expect(checkout.json()).toMatchObject({ code: "PLAN_UNCHANGED" });
  for (const origin of ["https://untrusted.example", undefined]) {
    const requestHeaders = injectHeaders(org.owner);
    delete requestHeaders.origin;
    if (origin) requestHeaders.origin = origin;
    const rejected = await app.inject({
      method: "POST",
      url: "/api/v1/billing/portal",
      headers: requestHeaders,
      payload: {},
    });
    expect(rejected.statusCode, rejected.body).toBe(403);
    expect(rejected.json()).toMatchObject({ code: "CSRF_ORIGIN" });
  }
  expect(stripe.requests).toHaveLength(initial);
  expect((await finance(org.owner, "portal")).statusCode).toBe(200);
});

// @req R-SAAS-05 R-SAAS-06
it.each(["customer", "public"] as const)(
  "keeps %s runtime pricing, finance and webhook boundaries unmetered and disabled even when Stripe credentials exist",
  async (mode) => {
    const org = await account(`disabled-${mode}`);
    // The SaaS instance shape with only the billing mode and auth instance mode changed.
    const isolated = await startApp(
      db,
      { INSTANCE_MODE: "saas" },
      {
        configure: (env) => ({
          ...env,
          auth: { ...runtime.services.auth.config, instanceMode: mode },
          billing: { ...env.billing, mode },
        }),
      },
    );
    const isolatedApp = isolated.app;
    try {
      const config = await isolatedApp.inject({
        method: "GET",
        url: "/api/v1/billing/config",
      });
      expect(config.statusCode).toBe(200);
      expect(config.json()).toMatchObject({
        mode,
        enabled: false,
        checkout_enabled: false,
      });
      const usage = await isolatedApp.inject({
        method: "GET",
        url: "/api/v1/billing",
        headers: injectHeaders(org.owner),
      });
      expect(usage.statusCode, usage.body).toBe(200);
      expect(billingUsageSchema.parse(usage.json())).toMatchObject({
        plan: "unmetered",
        included_records: null,
        remaining: null,
        can_manage: false,
        checkout_enabled: false,
        portal_enabled: false,
      });
      const initial = stripe.requests.length;
      for (const action of ["checkout", "portal"]) {
        const response = await isolatedApp.inject({
          method: "POST",
          url: `/api/v1/billing/${action}`,
          headers: injectHeaders(org.owner),
          payload: action === "checkout" ? { plan: "pro" } : {},
        });
        expect(response.statusCode, response.body).toBe(503);
      }
      const payload = JSON.stringify(
        event(
          "customer.subscription.created",
          stripe.subscription(`sub_${randomUUID()}`, org.customer),
        ),
      );
      const webhook = await isolatedApp.inject({
        method: "POST",
        url: "/auth/stripe/webhook",
        headers: {
          "content-type": "application/json",
          "stripe-signature": signedHeader({ payload, secret: signingSecret }),
        },
        payload,
        remoteAddress: clientIp,
      });
      expect(webhook.statusCode, webhook.body).toBe(404);
      expect(stripe.requests).toHaveLength(initial);
    } finally {
      await isolated.close();
    }
  },
);

// @req R-SAAS-05 @req R-SAAS-06
it.each(["active", "past_due"])(
  "updates the native optional embeddings plan with actual %s state and a fixed internal completion URL",
  async (status) => {
    const org = await account(`metered-upgrade-${status.replaceAll("_", "-")}`);
    const native = stripe.subscription(`sub_${randomUUID()}`, org.customer);
    const item = native.items.data[0];
    if (!item) throw new Error("Missing native base item");
    native.items.data.push({
      ...item,
      id: `si_capture_${randomUUID()}`,
      price: stripe.priceFor(stripe.billing.capturePriceId),
    });
    stripe.current.set(native.id, native);
    expect(
      (await send(event("customer.subscription.created", native))).statusCode,
    ).toBe(200);
    stripe.updateStatuses.set(native.id, status);
    const before = stripe.requests.length;
    const response = await finance(org.owner, "checkout", {
      plan: "pro_embeddings",
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(billingRedirectSchema.parse(response.json())).toEqual({ url: null });
    const request = stripe.requests
      .slice(before)
      .find(
        (row) =>
          row.method === "POST" &&
          row.path === `/v1/subscriptions/${native.id}`,
      );
    expect(request).toBeDefined();
    expect([...(request?.body.values() ?? [])]).toContain(
      stripe.billing.embeddingsPriceId,
    );
    expect([...(request?.body.values() ?? [])]).toContain(
      stripe.billing.embeddingUsagePriceId,
    );
    const subscription = await stored(native.id);
    expect(subscription).toMatchObject({ plan: "pro_embeddings", status });
    expect((await runtime.services.billing.usage(org.owner)).result.plan).toBe(
      status === "active" ? "pro_embeddings" : "free",
    );
  },
);

// @req R-SAAS-05 @req R-EMB-06
it("reconciles Stripe remotely before waiting to publish paid entitlement behind an active native trace read", async () => {
  const org = await account("entitlement-fence");
  const native = stripe.subscription(
    `sub_${randomUUID()}`,
    org.customer,
    "active",
    "price_pro_embeddings",
  );
  stripe.current.set(native.id, native);
  expect(
    (await send(event("customer.subscription.created", native))).statusCode,
  ).toBe(200);
  let began: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    began = resolve;
  });
  let release: () => void = () => {};
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reading = db.traceReaders.read(
    requireCaller(org.context),
    async (client) => {
      await client.query("SELECT 1 AS ready");
      began();
      await hold;
      return client.query("SELECT 1 AS finished");
    },
  );
  await ready;
  stripe.current.set(native.id, { ...native, status: "canceled" });
  const initial = stripe.requests.length;
  let finished = false;
  const writing = send(event("customer.subscription.updated", native)).then(
    (result) => {
      finished = true;
      return result;
    },
  );
  try {
    await expect
      .poll(
        () =>
          stripe.requests
            .slice(initial)
            .some(
              (row) =>
                row.method === "GET" &&
                row.path === `/v1/subscriptions/${native.id}`,
            ),
        { timeout: 2000, interval: 20 },
      )
      .toBe(true);
    expect((await stored(native.id)).status).toBe("active");
    expect(finished).toBe(false);
  } finally {
    release();
  }
  await reading;
  expect((await writing).statusCode).toBe(200);
  expect((await stored(native.id)).status).toBe("canceled");
});

// @req R-SAAS-06 @req R-SAAS-08
it("rejects decimal flat fees on either capture tier before creating native checkout", async () => {
  const org = await account("capture-flat-fees");
  const id = stripe.billing.capturePriceId;
  const base = stripe.priceFor(id);
  const initial = stripe.requests.filter(
    (request) => request.path === "/v1/checkout/sessions",
  ).length;
  try {
    for (const tier of [0, 1]) {
      stripe.priceOverrides.set(id, {
        ...base,
        tiers: [
          {
            up_to: stripe.billing.includedRecords,
            unit_amount: 0,
            unit_amount_decimal: "0",
            flat_amount: null,
            flat_amount_decimal: tier === 0 ? "0.5" : "0",
          },
          {
            up_to: null,
            unit_amount: null,
            unit_amount_decimal: String(
              stripe.billing.captureCentsPer1000 / 1000,
            ),
            flat_amount: null,
            flat_amount_decimal: tier === 1 ? "0.5" : "0",
          },
        ],
      });
      const response = await finance(org.owner, "checkout");
      expect(response.statusCode, response.body).toBe(503);
      expect(response.json()).toMatchObject({ code: "BILLING_PRICE_MISMATCH" });
    }
  } finally {
    stripe.priceOverrides.delete(id);
  }
  expect(
    stripe.requests.filter(
      (request) => request.path === "/v1/checkout/sessions",
    ),
  ).toHaveLength(initial);
});
