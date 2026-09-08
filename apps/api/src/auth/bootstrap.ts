import { parseArgs } from "node:util";
import { z } from "zod";
import { type PrismaClient } from "@agentcommons/db";
import {
  createAuth,
  type AuthConfiguration,
  type PasswordDelivery,
} from "./config.js";
import { membershipTransaction } from "./transaction.js";
import { seedPolicies } from "../services/policies.js";
import { AuditService } from "../services/audit.js";
import { ServiceError, type ServiceContext } from "../services/context.js";

export const bootstrapInputSchema = z.object({
  email: z.email().transform((value) => value.toLowerCase()),
  organization: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .default("default"),
  name: z.string().trim().min(1).default("AgentCommons"),
});
export function operatorContext(): ServiceContext {
  return {
    caller: null,
    requestId: crypto.randomUUID(),
    transport: "rest",
    ip: null,
    userAgent: "agentcommons operator CLI",
    startedAt: Date.now(),
    headers: new Headers(),
  };
}

export async function bootstrap(
  prisma: PrismaClient,
  config: AuthConfiguration,
  input: z.input<typeof bootstrapInputSchema>,
) {
  const parsed = bootstrapInputSchema.parse(input);
  return membershipTransaction(prisma, async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`bootstrap:${parsed.organization}`},0))`;
    let delivery: PasswordDelivery | undefined;
    const native = createAuth(tx, config, (value) => {
      delivery = value;
    });
    let user = await tx.user.findUnique({ where: { email: parsed.email } });
    if (!user) {
      const created = await native.api.createUser({
        body: { email: parsed.email, name: parsed.email },
      });
      user = await tx.user.findUniqueOrThrow({
        where: { id: created.user.id },
      });
    }
    let organization = await tx.organization.findUnique({
      where: { slug: parsed.organization },
    });
    if (!organization) {
      const created = await native.api.createOrganization({
        body: { name: parsed.name, slug: parsed.organization, userId: user.id },
      });
      organization = await tx.organization.findUniqueOrThrow({
        where: { id: created.id },
      });
    } else {
      await tx.$queryRaw`SELECT id FROM organization WHERE id=${organization.id} FOR UPDATE`;
      const existing = await tx.member.findFirst({
        where: { userId: user.id, organizationId: organization.id },
      });
      if (existing && existing.role !== "owner")
        throw new ServiceError(
          409,
          "EXISTING_MEMBERSHIP",
          "This identity already has a different role. Use an existing owner to change it.",
        );
      if (!existing)
        await native.api.addMember({
          body: {
            organizationId: organization.id,
            userId: user.id,
            role: "owner",
          },
        });
    }
    await tx.$queryRaw`SELECT id FROM "user" WHERE id=${user.id} FOR UPDATE`;
    const accounts = await tx.account.count({ where: { userId: user.id } });
    if (config.emailPasswordEnabled && accounts === 0)
      await native.api.requestPasswordReset({
        body: {
          email: user.email,
          redirectTo: `${config.publicUrl}/setup-password`,
        },
      });
    await seedPolicies(tx, organization.id, user.id);
    const audit = await new AuditService(prisma).write(
      operatorContext(),
      {
        action: "operator.bootstrap",
        resourceType: "organization",
        resourceIds: [organization.id, user.id],
        actor: {
          userId: null,
          apiKeyId: null,
          authMethod: "operator",
          organizationId: organization.id,
        },
      },
      tx,
    );
    return {
      result: {
        organization_id: organization.id,
        user_id: user.id,
        setup_url: delivery?.url ?? null,
      },
      audit,
    };
  });
}

export async function recover(
  prisma: PrismaClient,
  config: AuthConfiguration,
  email: string,
) {
  const parsed = z.email().parse(email).toLowerCase();
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { email: parsed } });
    if (!user) throw new ServiceError(404, "NOT_FOUND", "Account not found.");
    let delivery: PasswordDelivery | undefined;
    await createAuth(tx, config, (value) => {
      delivery = value;
    }).api.requestPasswordReset({
      body: {
        email: user.email,
        redirectTo: `${config.publicUrl}/setup-password`,
      },
    });
    if (!delivery) throw new Error("Recovery URL was not generated");
    const audit = await new AuditService(prisma).write(
      operatorContext(),
      {
        action: "operator.recover",
        resourceType: "user",
        resourceIds: [user.id],
        actor: { userId: null, apiKeyId: null, authMethod: "operator" },
      },
      tx,
    );
    return { result: { setup_url: delivery.url }, audit };
  });
}

export function operatorArguments(kind: "seed" | "recover") {
  const { values } = parseArgs({
    options:
      kind === "seed"
        ? {
            admin: { type: "string" },
            organization: { type: "string" },
            name: { type: "string" },
          }
        : { email: { type: "string" } },
  });
  if (kind === "recover") return z.object({ email: z.email() }).parse(values);
  return bootstrapInputSchema.parse({
    email: values.admin,
    ...(values.organization ? { organization: values.organization } : {}),
    ...(values.name ? { name: values.name } : {}),
  });
}
