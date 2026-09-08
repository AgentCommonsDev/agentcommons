import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { billingUsageSchema } from "../packages/core/schemas/billing.js";
import { ingestEnvelopeSchema } from "../packages/core/schemas/ingest.js";
import {
  startTraceDatabase,
  traceEnvironment,
} from "../packages/traces/test/support.js";
import {
  provisionOrganization,
  provisionMember,
  testAuthConfiguration,
} from "../apps/api/test/support.js";
import { startMailpit } from "../apps/api/test/mailpit.js";
import { createRuntime } from "../apps/api/src/main.js";
import { createApp } from "../apps/api/src/app.js";
import { environment } from "../apps/api/src/env.js";
import { verifyCanaryEmail } from "../scripts/canary-auth.js";
import { requireCaller } from "../apps/api/src/services/context.js";
import { cleanup } from "../scripts/cleanup.js";

const origin = "http://localhost:3905";
let database: Awaited<ReturnType<typeof startTraceDatabase>>;
let mail: Awaited<ReturnType<typeof startMailpit>>;
let owner: Awaited<ReturnType<typeof provisionOrganization>>;
let member: Awaited<ReturnType<typeof provisionMember>>;
const release: Array<() => Promise<unknown>> = [];
beforeAll(async () => {
  database = await startTraceDatabase({
    ...testAuthConfiguration,
    publicUrl: origin,
  });
  release.unshift(() => database.close());
  mail = await startMailpit();
  release.unshift(() => mail.close());
  owner = await provisionOrganization(database, "native-saas-canary");
  member = await provisionMember(
    database,
    owner.owner,
    "native-saas-canary-member@example.com",
  );
  const env = environment({
    ...traceEnvironment(database.traceConfig),
    PUBLIC_URL: origin,
    DATABASE_URL: database.urls.app,
    BETTER_AUTH_SECRET: testAuthConfiguration.secret,
    INSTANCE_MODE: "saas",
    EMAIL_TRANSPORT: "smtp",
    EMAIL_FROM: "no-reply@agentcommons.test",
    SMTP_URL: mail.smtpUrl,
    LOG_LEVEL: "silent",
    TRUST_PROXY: "loopback",
    EMBEDDINGS_ENABLED: "false",
  });
  const runtime = await createRuntime(env);
  release.unshift(() => runtime.close());
  const app = await createApp({ env, services: runtime.services });
  release.unshift(() => app.close());
  await app.listen({ port: 3905, host: "127.0.0.1" });
});
afterAll(async () => {
  expect(await cleanup(release.splice(0))).toEqual([]);
});

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
  const input = ingestEnvelopeSchema.parse({
    envelopeVersion: 2,
    harness: "CLAUDE_CODE",
    harnessSessionId: randomUUID(),
    installationId: randomUUID(),
    batchId: randomUUID(),
    behavior: "sync",
    start: null,
    nativeEvent: "Stop",
    sentAt: new Date().toISOString(),
    sourcePos: 0,
    cursor: "0",
    end: null,
    context: {
      cwd: "/canary",
      git: null,
      parentHint: null,
      installation: {
        hostname: "native-canary",
        osUser: "test",
        platform: "linux",
        arch: "x64",
      },
    },
    records: [
      {
        pos: 0,
        key: randomUUID(),
        sourceVersion: 0,
        line: JSON.stringify({
          type: "user",
          uuid: randomUUID(),
          message: { content: "A real canary admission" },
        }),
      },
    ],
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
