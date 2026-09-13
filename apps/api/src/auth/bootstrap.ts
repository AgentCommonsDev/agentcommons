import { parseArgs } from "node:util";
import { z } from "zod";
import { PrismaClient } from "@agentcommons/db";
import {
  callerContextSchema,
  type CallerContext,
} from "@agentcommons/core/schemas";
import {
  createAuth,
  passwordSetupUrl,
  type AuthConfiguration,
  type PasswordDelivery,
} from "./config.js";
import { authEnvironment } from "./environment.js";
import { membershipTransaction } from "./transaction.js";
import { seedPolicies } from "../services/policies.js";
import { AuditService, type AuditActor } from "../services/audit.js";
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

function systemActor(
  authMethod: "worker" | "operator",
  organizationId?: string,
): AuditActor {
  return {
    userId: null,
    apiKeyId: null,
    authMethod,
    ...(organizationId === undefined ? {} : { organizationId }),
  };
}

/** Audit actor for background workers acting on an organization's behalf. */
export function workerActor(organizationId?: string): AuditActor {
  return systemActor("worker", organizationId);
}

/** Audit actor for operator CLI commands and boot-time maintenance. */
export function operatorActor(organizationId?: string): AuditActor {
  return systemActor("operator", organizationId);
}

/**
 * The principal a background worker reads one organization's traces with: admin
 * authority under the literal user `worker`, so the work depends on no person's
 * membership or API key (ADR 0079). Its ClickHouse reader is fenced by the same native
 * row policies as every caller; rows it derives are read back under each caller's own
 * principal, and renders it produces are cached under the shared admin scope only.
 */
export function workerCaller(organizationId: string): CallerContext {
  return callerContextSchema.parse({
    organizationId,
    userId: "worker",
    role: "owner",
    apiKeyId: null,
    authMethod: "key",
    permissions: { sessions: ["read"], admin: ["*"] },
  });
}

export async function bootstrap(
  prisma: PrismaClient,
  config: AuthConfiguration,
  input: z.input<typeof bootstrapInputSchema>,
) {
  const parsed = bootstrapInputSchema.parse(input);
  const audits = new AuditService(prisma);
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
        body: {
          name: await audits.redactText(operatorContext(), parsed.name, tx),
          slug: parsed.organization,
          userId: user.id,
        },
      });
      organization = await tx.organization.findUniqueOrThrow({
        where: { id: created.id },
      });
    } else {
      await tx.$queryRaw`SELECT id FROM organization WHERE id=${organization.id} FOR UPDATE`;
      const existing = await tx.member.findFirst({
        where: { userId: user.id, organizationId: organization.id },
      });
      if (existing && (existing.role !== "owner" || existing.removedAt))
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
        body: { email: user.email, redirectTo: passwordSetupUrl(config) },
      });
    await seedPolicies(tx, organization.id, user.id);
    const audit = await audits.write(
      operatorContext(),
      {
        action: "operator.bootstrap",
        resourceType: "organization",
        resourceIds: [organization.id, user.id],
        actor: operatorActor(organization.id),
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
      body: { email: user.email, redirectTo: passwordSetupUrl(config) },
    });
    if (!delivery) throw new Error("Recovery URL was not generated");
    const audit = await new AuditService(prisma).write(
      operatorContext(),
      {
        action: "operator.recover",
        resourceType: "user",
        resourceIds: [user.id],
        actor: operatorActor(),
      },
      tx,
    );
    return { result: { setup_url: delivery.url }, audit };
  });
}

/** `pnpm db:seed --admin <email> [--organization <slug>] [--name <name>]`. */
export function seedArguments(): z.infer<typeof bootstrapInputSchema> {
  const { values } = parseArgs({
    options: {
      admin: { type: "string" },
      organization: { type: "string" },
      name: { type: "string" },
    },
  });
  return bootstrapInputSchema.parse({
    email: values.admin,
    ...(values.organization ? { organization: values.organization } : {}),
    ...(values.name ? { name: values.name } : {}),
  });
}

/** `pnpm db:recover --email <email>`. */
export function recoverArguments(): { email: string } {
  const { values } = parseArgs({ options: { email: { type: "string" } } });
  return z.object({ email: z.email() }).parse(values);
}

/**
 * The scaffold every operator command shares: the native provider configuration from
 * the environment, one Prisma client for the command's lifetime, and the JSON result on
 * stdout.
 */
export async function runOperatorCommand(
  command: (
    prisma: PrismaClient,
    auth: AuthConfiguration,
  ) => Promise<{ result: unknown }>,
): Promise<void> {
  const env = authEnvironment(process.env);
  const prisma = new PrismaClient({ datasourceUrl: env.databaseUrl });
  try {
    const { result } = await command(prisma, env.auth);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}
