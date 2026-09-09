import { afterAll, beforeAll, expect, it } from "vitest";
import { billingUsageSchema } from "../packages/core/schemas/billing.js";
import { startTraceDatabase } from "../packages/traces/test/support.js";
import {
  provisionOrganization,
  provisionMember,
  releaser,
  testAuthConfiguration,
} from "../apps/api/test/support.js";
import { startApp } from "../apps/api/test/app.js";
import { testEnvelope, textRecord } from "../apps/api/test/envelopes.js";
import { startMailpit } from "../apps/api/test/mailpit.js";
import { verifyCanaryEmail } from "../scripts/canary-auth.js";
import { requireCaller } from "../apps/api/src/services/context.js";

const origin = "http://localhost:3905";
let database: Awaited<ReturnType<typeof startTraceDatabase>>;
let mail: Awaited<ReturnType<typeof startMailpit>>;
let owner: Awaited<ReturnType<typeof provisionOrganization>>;
let member: Awaited<ReturnType<typeof provisionMember>>;
const { defer, release } = releaser();
beforeAll(async () => {
  database = await startTraceDatabase({
    ...testAuthConfiguration,
    publicUrl: origin,
  });
  defer(() => database.close());
  mail = await startMailpit();
  defer(() => mail.close());
  owner = await provisionOrganization(database, "native-saas-canary");
  member = await provisionMember(
    database,
    owner.owner,
    "native-saas-canary-member@example.com",
  );
  const started = await startApp(
    database,
    {
      PUBLIC_URL: origin,
      INSTANCE_MODE: "saas",
      EMAIL_TRANSPORT: "smtp",
      EMAIL_FROM: "no-reply@agentcommons.test",
      SMTP_URL: mail.smtpUrl,
      TRUST_PROXY: "loopback",
    },
    { listen: true, port: 3905, static: true },
  );
  defer(() => started.close());
});
afterAll(release);

// @req R-HRN-08 @req R-SAAS-01 @req R-SAAS-03
it("verifies retained canary identities through native SMTP and charges actual SaaS capture once", async () => {
  expect(
    await database.prisma.user.count({
      where: {
        email: { in: [owner.email, member.email] },
        emailVerified: true,
      },
    }),
  ).toBe(0);
  const headers = {
    authorization: `Bearer ${member.key}`,
    "content-type": "application/json",
  };
  expect((await fetch(`${origin}/api/v1/billing`, { headers })).status).toBe(
    403,
  );
  for (const principal of [owner, member])
    await verifyCanaryEmail(origin, principal.email, mail);
  expect(
    await database.prisma.user.count({
      where: {
        email: { in: [owner.email, member.email] },
        emailVerified: true,
      },
    }),
  ).toBe(2);
  const input = testEnvelope({
    cursor: "0",
    context: {
      cwd: "/canary",
      installation: { hostname: "native-canary", osUser: "test" },
    },
    records: [textRecord(0, "A real canary admission")],
  });
  for (let replay = 0; replay < 2; replay++)
    expect(
      (
        await fetch(`${origin}/api/v1/ingest`, {
          method: "POST",
          headers,
          body: JSON.stringify(input),
        })
      ).status,
    ).toBe(202);
  const response = await fetch(`${origin}/api/v1/billing`, { headers });
  expect(response.status).toBe(200);
  const usage = billingUsageSchema.parse(await response.json());
  expect(usage).toMatchObject({
    plan: "free",
    records_used: 1,
    included_records: 1000,
    remaining: 999,
    checkout_enabled: false,
  });
  const organizationId = requireCaller(member.context).organizationId;
  expect(
    await database.prisma.usageAdmission.count({
      where: { organizationId, kind: "capture" },
    }),
  ).toBe(1);
  expect(
    await database.prisma.traceSourceAdmission.count({
      where: { organizationId },
    }),
  ).toBe(1);
});
