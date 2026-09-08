import { expect, it, vi } from "vitest";
import {
  billingRedirectSchema,
  defaultBillingConfig,
} from "@agentcommons/core/schemas/billing";
import { environment } from "../src/env.js";

const base = {
  PUBLIC_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "billing-environment-test-secret-at-least-32-characters",
  DATABASE_URL: "postgresql://app:fixture@localhost/database",
  CLICKHOUSE_URL: "http://localhost:8123",
  CLICKHOUSE_WRITER_USER: "writer",
  CLICKHOUSE_WRITER_PASSWORD: "fixture-writer",
  CLICKHOUSE_ACCESS_USER: "access",
  CLICKHOUSE_ACCESS_PASSWORD: "fixture-access",
  CLICKHOUSE_READER_SECRET: "fixture-readers-at-least-thirty-two-characters",
};

// @req R-SAAS-06
it("accepts only secure Stripe destinations before a browser opens checkout or its portal", () => {
  for (const url of [
    "https://checkout.stripe.com/c/pay/cs_test_fixture",
    "https://billing.stripe.com/p/session/test_fixture",
  ])
    expect(billingRedirectSchema.parse({ url })).toEqual({ url });
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,redirect",
    "http://checkout.stripe.com/pay",
    "https://checkout.stripe.com.evil.example/pay",
    "https://attacker:password@billing.stripe.com/session",
    "https://other.example/pay",
  ])
    expect(billingRedirectSchema.safeParse({ url }).success).toBe(false);
});

// @req R-SAAS-03 @req R-SAAS-07
it("shares public default allowances and accepts operator overrides only as valid bounded integer plans", () => {
  expect(environment(base).billing).toEqual({
    mode: defaultBillingConfig.mode,
    freeMonthlyRecords: defaultBillingConfig.plans.free.monthly_records,
    proIncludedRecords: defaultBillingConfig.plans.pro.included_records,
    calComUrl: null,
    captureCentsPer1000: null,
    embeddingCentsPer1000: null,
    captureEventName: null,
    embeddingEventName: null,
  });
  expect(
    environment({
      ...base,
      INSTANCE_MODE: "saas",
      FREE_MONTHLY_RECORDS: "10",
      PRO_INCLUDED_RECORDS: "20",
      CAL_COM_URL: "https://cal.com/agentcommons/demo",
    }).billing,
  ).toEqual({
    mode: "saas",
    freeMonthlyRecords: 10,
    proIncludedRecords: 20,
    calComUrl: "https://cal.com/agentcommons/demo",
    captureCentsPer1000: null,
    embeddingCentsPer1000: null,
    captureEventName: null,
    embeddingEventName: null,
  });
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    for (const invalid of ["-1", "1.5", "NaN", "9007199254740992"])
      expect(() =>
        environment({ ...base, FREE_MONTHLY_RECORDS: invalid }),
      ).toThrow();
    expect(() =>
      environment({
        ...base,
        FREE_MONTHLY_RECORDS: "20",
        PRO_INCLUDED_RECORDS: "10",
      }),
    ).toThrow("PRO_INCLUDED_RECORDS");
    for (const url of [
      "http://cal.com/team/demo",
      "https://other.example/demo",
      "https://name:password@cal.com/demo",
    ])
      expect(() => environment({ ...base, CAL_COM_URL: url })).toThrow();
  } finally {
    log.mockRestore();
  }
});
