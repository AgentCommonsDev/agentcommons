import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  provisionMember,
  provisionOrganization,
  startDatabase,
} from "./support.js";

let database: Awaited<ReturnType<typeof startDatabase>>;
let organization: Awaited<ReturnType<typeof provisionOrganization>>;
let member: Awaited<ReturnType<typeof provisionMember>>;
let other: Awaited<ReturnType<typeof provisionOrganization>>;

beforeAll(async () => {
  database = await startDatabase();
  organization = await provisionOrganization(database, "keys-primary");
  member = await provisionMember(
    database,
    organization.owner,
    "keys-member@example.com",
  );
  other = await provisionOrganization(database, "keys-other");
}, 180_000);
afterAll(async () => {
  await database.close();
});

// @req R-AUTH-05
it("reveals the exact plaintext to its owner from a cookie session, audits it, and forgets it on revoke", async () => {
  const created = await database.auth.createKey(organization.owner, {
    name: "Reveal laptop",
    permissions: { sessions: ["ingest", "read"] },
  });
  const id = created.result.metadata.id;
  const plaintext = created.result.key;

  // The copy at rest is ciphertext, written in the creating transaction.
  const stored = await database.prisma.apiKeySecret.findUniqueOrThrow({
    where: { apiKeyId: id },
  });
  expect(stored.organizationId).toBe(organization.owner.caller?.organizationId);
  expect(stored.userId).toBe(organization.owner.caller?.userId);
  expect(Buffer.from(stored.ciphertext).includes(plaintext)).toBe(false);
  expect(stored.iv).toHaveLength(12);

  const revealed = await database.auth.revealKey(organization.owner, id);
  expect(revealed.result).toEqual({ key: plaintext });
  expect(revealed.audit.action).toBe("keys.reveal");
  expect(revealed.audit.resourceIds).toEqual([id]);
  const audits = await database.prisma.auditEvent.findMany({
    where: { action: "keys.reveal", resourceIds: { has: id } },
  });
  expect(audits).toHaveLength(1);
  expect(JSON.stringify(audits)).not.toContain(plaintext);

  // Another member, another organization, and an unknown id look the same: missing.
  await expect(database.auth.revealKey(member.owner, id)).rejects.toMatchObject(
    { statusCode: 404, code: "NOT_FOUND" },
  );
  await expect(database.auth.revealKey(other.owner, id)).rejects.toMatchObject({
    statusCode: 404,
    code: "NOT_FOUND",
  });
  await expect(
    database.auth.revealKey(organization.owner, randomUUID()),
  ).rejects.toMatchObject({ statusCode: 404, code: "NOT_FOUND" });

  // A request authenticated with an API key never reads a key, even its own.
  await expect(
    database.auth.revealKey(organization.context, id),
  ).rejects.toMatchObject({
    statusCode: 403,
    code: "KEY_REVEAL_SESSION_REQUIRED",
  });
  await expect(
    database.auth.revealKey(
      organization.context,
      organization.context.caller?.apiKeyId ?? "",
    ),
  ).rejects.toMatchObject({ code: "KEY_REVEAL_SESSION_REQUIRED" });
  expect(
    await database.prisma.auditEvent.count({
      where: { action: "keys.reveal", resourceIds: { has: id } },
    }),
  ).toBeGreaterThan(1);
  expect(
    JSON.stringify(
      await database.prisma.auditEvent.findMany({
        where: { action: "keys.reveal" },
      }),
    ),
  ).not.toContain(plaintext);

  // Revocation deletes the encrypted copy in the same transaction.
  await database.auth.revokeKey(organization.owner, id, {
    reason: "Laptop retired",
  });
  await expect(
    database.auth.revealKey(organization.owner, id),
  ).rejects.toMatchObject({ statusCode: 404, code: "NOT_FOUND" });
  expect(
    await database.prisma.apiKeySecret.count({ where: { apiKeyId: id } }),
  ).toBe(0);
  expect(
    await database.prisma.apiKeyOwner.count({ where: { keyId: id } }),
  ).toBe(1);
});

// @req R-AUTH-05
it("deletes a member's encrypted copy when an admin revokes the key", async () => {
  const created = await database.auth.createKey(member.owner, {
    name: "Member laptop",
    permissions: { sessions: ["ingest", "read"] },
  });
  const id = created.result.metadata.id;
  expect((await database.auth.revealKey(member.owner, id)).result.key).toBe(
    created.result.key,
  );
  await expect(
    database.auth.revealKey(organization.owner, id),
  ).rejects.toMatchObject({ statusCode: 404 });
  await database.auth.revokeKey(
    organization.owner,
    id,
    { reason: "Offboarding" },
    false,
  );
  expect(
    await database.prisma.apiKeySecret.count({ where: { apiKeyId: id } }),
  ).toBe(0);
  await expect(database.auth.revealKey(member.owner, id)).rejects.toMatchObject(
    { statusCode: 404 },
  );
});
