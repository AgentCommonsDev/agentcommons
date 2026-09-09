import {
  startTraceDatabase,
  traceEnvironment,
} from "../../../packages/traces/test/support.js";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { AuditService } from "../src/services/audit.js";
import { createRuntime } from "../src/main.js";
import { environment } from "../src/env.js";
import {
  provisionOrganization,
  releaser,
  testAuthConfiguration,
} from "./support.js";
let database: Awaited<ReturnType<typeof startTraceDatabase>>;
const { defer, release } = releaser();
beforeAll(async () => {
  database = await startTraceDatabase();
  defer(() => database.close());
}, 120_000);
afterAll(release);

// @req R-RED-07 @req R-AUD-01
it("seeds validated extra policies for every organization at boot, preserves them on restart, and rejects invalid configuration", async () => {
  const first = await provisionOrganization(database, "runtime-one");
  const second = await provisionOrganization(database, "runtime-two");
  const options = {
    PUBLIC_URL: testAuthConfiguration.publicUrl,
    DATABASE_URL: database.urls.app,
    ...traceEnvironment(database.traceConfig),
    BETTER_AUTH_SECRET: testAuthConfiguration.secret,
    LOG_LEVEL: "silent",
    REDACTION_EXTRA_PATTERNS: JSON.stringify([
      {
        name: "boot_pattern",
        kind: "REGEX",
        pattern: "company-sensitive",
        flags: "g",
      },
    ]),
  };
  for (let boot = 0; boot < 2; boot++) {
    const runtime = await createRuntime(environment(options));
    try {
      for (const organization of [first, second]) {
        expect(
          (
            await runtime.services.policies.test(organization.owner, {
              text: "company-sensitive",
            })
          ).result.text,
        ).toBe("[REDACTED:boot_pattern]");
        expect(
          await database.prisma.redactionPolicy.count({
            where: {
              organizationId: organization.owner.caller?.organizationId ?? "",
              name: "boot_pattern",
            },
          }),
        ).toBe(1);
        const audit = await database.prisma.auditEvent.findMany({
          where: {
            organizationId: organization.owner.caller?.organizationId ?? "",
            action: "redaction.policies.seed",
          },
        });
        expect(audit).toHaveLength(1);
        expect(audit[0]).toMatchObject({
          authMethod: "operator",
          detail: { inserted_count: 1 },
        });
      }
    } finally {
      await runtime.close();
    }
  }
  await expect(
    createRuntime(
      environment({
        ...options,
        REDACTION_EXTRA_PATTERNS:
          '[{"name":"invalid","kind":"REGEX","pattern":"["}]',
      }),
    ),
  ).rejects.toThrow();
});

// @req R-AUD-01 @req R-RED-07
it("rolls boot policy seeding back if audit fails and concurrent restarts audit each inserted policy once", async () => {
  await provisionOrganization(database, "runtime-rollback");
  const options = environment({
    PUBLIC_URL: testAuthConfiguration.publicUrl,
    DATABASE_URL: database.urls.app,
    ...traceEnvironment(database.traceConfig),
    BETTER_AUTH_SECRET: testAuthConfiguration.secret,
    REDACTION_EXTRA_PATTERNS: JSON.stringify([
      { name: "rollback_pattern", kind: "REGEX", pattern: "boot-private-text" },
    ]),
  });
  const before = await database.prisma.auditEvent.count({
    where: { action: "redaction.policies.seed" },
  });
  const fault = vi
    .spyOn(AuditService.prototype, "write")
    .mockRejectedValueOnce(new Error("Injected boot audit failure"));
  try {
    await expect(createRuntime(options)).rejects.toThrow(
      "Injected boot audit failure",
    );
  } finally {
    fault.mockRestore();
  }
  expect(
    await database.prisma.redactionPolicy.count({
      where: { name: "rollback_pattern" },
    }),
  ).toBe(0);
  expect(
    await database.prisma.auditEvent.count({
      where: { action: "redaction.policies.seed" },
    }),
  ).toBe(before);
  const runtimes = await Promise.all([
    createRuntime(options),
    createRuntime(options),
  ]);
  try {
    const count = await database.prisma.organization.count();
    expect(
      await database.prisma.redactionPolicy.count({
        where: { name: "rollback_pattern" },
      }),
    ).toBe(count);
    expect(
      await database.prisma.auditEvent.count({
        where: { action: "redaction.policies.seed" },
      }),
    ).toBe(before + count);
  } finally {
    await Promise.all(runtimes.map((runtime) => runtime.close()));
  }
});
