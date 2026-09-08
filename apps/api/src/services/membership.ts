import { auditedOperation } from "./audit.js";
import { z } from "zod";
import {
  memberAddInputSchema,
  memberAddOutputSchema,
  membersInputSchema,
  membersOutputSchema,
  memberRoleInputSchema,
  memberSuspensionInputSchema,
  reasonInputSchema,
  passwordSetupOutputSchema,
  type CallerContext,
} from "@agentcommons/core/schemas";
import { Prisma, type PrismaClient, type Member } from "@agentcommons/db";
import {
  createAuth,
  type AuthConfiguration,
  type PasswordDelivery,
  PASSWORD_SETUP_SECONDS,
} from "../auth/config.js";
import { membershipTransaction } from "../auth/transaction.js";
import { invalidateSetupTokens } from "../auth/setup-tokens.js";
import type { AuditService } from "./audit.js";
import { lockOrganization, requireCookie } from "./auth.js";
import { CursorCodec } from "./cursor.js";
import {
  requirePermission,
  ServiceError,
  type ServiceContext,
} from "./context.js";

function requireMemberAdmin(context: ServiceContext): CallerContext {
  requireCookie(context);
  return requirePermission(context, "admin");
}

async function editableMember(
  tx: Prisma.TransactionClient,
  caller: CallerContext,
  id: string,
  relinquishesOwner: boolean,
): Promise<Member> {
  const target = await tx.member.findFirst({
    where: { id, organizationId: caller.organizationId, removedAt: null },
  });
  if (!target) throw new ServiceError(404, "NOT_FOUND", "Member not found.");
  await tx.$queryRaw`SELECT id FROM "user" WHERE id=${target.userId} FOR UPDATE`;
  if (target.role === "owner" && caller.role !== "owner")
    throw new ServiceError(
      403,
      "OWNER_REQUIRED",
      "Only an owner can change another owner's membership.",
    );
  if (relinquishesOwner && target.role === "owner" && !target.suspended) {
    const owners = await tx.member.count({
      where: {
        organizationId: caller.organizationId,
        role: "owner",
        suspended: false,
        removedAt: null,
      },
    });
    if (owners <= 1)
      throw new ServiceError(
        409,
        "LAST_OWNER",
        "Add another active owner before changing this membership.",
      );
  }
  return target;
}

export class MembershipService {
  private readonly cursors: CursorCodec;
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AuthConfiguration,
    private readonly audit: AuditService,
  ) {
    this.cursors = new CursorCodec(config.secret);
  }

  async list(
    context: ServiceContext,
    input: z.input<typeof membersInputSchema>,
  ) {
    return auditedOperation(
      this.audit,
      context,
      { action: "members.list" },
      async () => {
        const caller = requirePermission(context, "admin");
        const parsed = membersInputSchema.parse(input);
        const { cursor, ...query } = parsed;
        const binding = z.json().parse(
          JSON.parse(
            JSON.stringify({
              organizationId: caller.organizationId,
              operation: "members",
              input: query,
            }),
          ),
        );
        const offset = cursor
          ? this.cursors.decode(cursor, binding, z.number().int().nonnegative())
          : 0;
        const field = parsed.sort ?? "created_at";
        const orderBy: Prisma.MemberOrderByWithRelationInput =
          field === "email" || field === "name"
            ? { user: { [field]: parsed.order } }
            : {
                [{
                  created_at: "createdAt",
                  role: "role",
                  suspended: "suspended",
                }[field]]: parsed.order,
              };
        const rows = await this.prisma.member.findMany({
          where: {
            organizationId: caller.organizationId,
            removedAt: null,
            ...(parsed.filters.email
              ? { user: { email: parsed.filters.email.toLowerCase() } }
              : {}),
            ...(parsed.filters.role ? { role: parsed.filters.role } : {}),
            ...(parsed.filters.suspended === undefined
              ? {}
              : { suspended: parsed.filters.suspended }),
          },
          include: { user: true },
          orderBy: [orderBy, { id: "asc" }],
          skip: offset,
          take: parsed.limit + 1,
        });
        const items = rows.slice(0, parsed.limit).map((member) => ({
          id: member.id,
          organization_id: member.organizationId,
          user_id: member.userId,
          email: member.user.email,
          name: member.user.name,
          role: member.role,
          suspended: member.suspended ?? false,
          created_at: member.createdAt.toISOString(),
        }));
        const result = membersOutputSchema.parse({
          items,
          cursor:
            rows.length > parsed.limit
              ? this.cursors.encode(binding, offset + parsed.limit)
              : null,
        });
        const audit = await this.audit.write(context, {
          action: "members.list",
          resourceType: "member",
          detail: { ...query, row_count: items.length },
        });
        return { result, audit };
      },
    );
  }

  async add(
    context: ServiceContext,
    input: z.input<typeof memberAddInputSchema>,
  ) {
    return auditedOperation(
      this.audit,
      context,
      { action: "members.add" },
      async () => {
        const caller = requireMemberAdmin(context);
        const parsed = memberAddInputSchema.parse(input);
        if (parsed.role === "owner" && caller.role !== "owner")
          throw new ServiceError(
            403,
            "OWNER_REQUIRED",
            "Only an owner can add another owner.",
          );
        return membershipTransaction(this.prisma, async (tx) => {
          await lockOrganization(tx, caller);
          const deliveries = new Map<string, PasswordDelivery>();
          const auth = createAuth(tx, this.config, (delivery) =>
            deliveries.set(delivery.userId, delivery),
          );
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM "user" WHERE email IN (${Prisma.join(parsed.emails.map((email) => email.toLowerCase()))}) ORDER BY id FOR UPDATE`,
          );
          const results: z.infer<typeof memberAddOutputSchema>["results"] = [];
          const memberIds: string[] = [];
          for (const address of parsed.emails) {
            const email = address.toLowerCase();
            const existing = await tx.user.findUnique({ where: { email } });
            const current = existing
              ? await tx.member.findFirst({
                  where: {
                    userId: existing.id,
                    organizationId: caller.organizationId,
                  },
                })
              : null;
            if (current && !current.removedAt) {
              results.push({
                email,
                status: "existing",
                user_id: current.userId,
                setup_url: null,
                error: null,
              });
              continue;
            }
            if (
              existing &&
              (await tx.account.count({ where: { userId: existing.id } })) ===
                0 &&
              (await tx.member.count({
                where: {
                  userId: existing.id,
                  organizationId: { not: caller.organizationId },
                  removedAt: null,
                },
              })) > 0
            ) {
              throw new ServiceError(
                409,
                "IDENTITY_UNCLAIMED",
                "This person must finish account setup before joining another organization.",
              );
            }
            const user =
              existing ??
              (await auth.api.createUser({ body: { email, name: email } }))
                .user;
            let member: { id: string };
            if (current) {
              const native = await auth.$context;
              await native.adapter.update({
                model: "member",
                where: [{ field: "id", value: current.id }],
                update: {
                  role: parsed.role,
                  suspended: false,
                  removedAt: null,
                },
              });
              member = current;
            } else {
              member = await auth.api.addMember({
                body: {
                  organizationId: caller.organizationId,
                  userId: user.id,
                  role: parsed.role,
                },
              });
            }
            memberIds.push(member.id);
            if (!existing && this.config.emailPasswordEnabled)
              await auth.api.requestPasswordReset({
                body: {
                  email,
                  redirectTo: `${this.config.publicUrl}/setup-password`,
                },
              });
            results.push({
              email,
              status: "added",
              user_id: user.id,
              setup_url: deliveries.get(user.id)?.url ?? null,
              error: null,
            });
          }
          const result = memberAddOutputSchema.parse({ results });
          const audit = await this.audit.write(
            context,
            {
              action: "members.add",
              resourceType: "member",
              resourceIds: memberIds,
              detail: {
                emails: parsed.emails.map((email) => email.toLowerCase()),
                role: parsed.role,
                added: memberIds.length,
              },
            },
            tx,
          );
          return { result, audit };
        });
      },
    );
  }

  async passwordSetup(context: ServiceContext, userId: string) {
    return auditedOperation(
      this.audit,
      context,
      { action: "members.password_setup" },
      async () => {
        const caller = requireMemberAdmin(context);
        if (!this.config.emailPasswordEnabled)
          throw new ServiceError(
            400,
            "PASSWORD_DISABLED",
            "Password login is disabled.",
          );
        return membershipTransaction(this.prisma, async (tx) => {
          await lockOrganization(tx, caller);
          await tx.$queryRaw`SELECT id FROM "user" WHERE id=${userId} FOR UPDATE`;
          const target = await tx.member.findFirst({
            where: {
              userId,
              organizationId: caller.organizationId,
              removedAt: null,
            },
            include: { user: true },
          });
          if (!target)
            throw new ServiceError(404, "NOT_FOUND", "Member not found.");
          if (
            (await tx.account.count({ where: { userId } })) !== 0 ||
            (await tx.member.count({
              where: {
                userId,
                organizationId: { not: caller.organizationId },
                removedAt: null,
              },
            })) !== 0
          ) {
            throw new ServiceError(
              409,
              "IDENTITY_ESTABLISHED",
              "An instance operator must recover an established account.",
            );
          }
          let delivery: PasswordDelivery | undefined;
          const native = createAuth(tx, this.config, (value) => {
            delivery = value;
          });
          await native.api.requestPasswordReset({
            body: {
              email: target.user.email,
              redirectTo: `${this.config.publicUrl}/setup-password`,
            },
          });
          if (!delivery)
            throw new Error("Password setup URL was not generated");
          const result = passwordSetupOutputSchema.parse({
            setup_url: delivery.url,
            expires_at: new Date(
              Date.now() + PASSWORD_SETUP_SECONDS * 1000,
            ).toISOString(),
          });
          const audit = await this.audit.write(
            context,
            {
              action: "members.password_setup",
              resourceType: "user",
              resourceIds: [userId],
            },
            tx,
          );
          return { result, audit };
        });
      },
    );
  }

  async role(
    context: ServiceContext,
    id: string,
    input: z.input<typeof memberRoleInputSchema>,
  ) {
    return auditedOperation(
      this.audit,
      context,
      { action: "members.role" },
      async () => {
        const caller = requireMemberAdmin(context);
        const parsed = memberRoleInputSchema.parse(input);
        if (parsed.role === "owner" && caller.role !== "owner")
          throw new ServiceError(
            403,
            "OWNER_REQUIRED",
            "Only an owner can grant owner authority.",
          );
        return membershipTransaction(this.prisma, async (tx) => {
          await lockOrganization(tx, caller);
          const member = await editableMember(
            tx,
            caller,
            id,
            parsed.role !== "owner",
          );
          if (member.role !== parsed.role)
            await createAuth(tx, this.config).api.updateMemberRole({
              headers: context.headers,
              body: {
                organizationId: caller.organizationId,
                memberId: id,
                role: parsed.role,
              },
            });
          const audit = await this.audit.write(
            context,
            {
              action: "members.role",
              resourceType: "member",
              resourceIds: [id],
              detail: parsed,
            },
            tx,
          );
          return {
            result: { id, updated: member.role !== parsed.role },
            audit,
          };
        });
      },
    );
  }

  async suspend(
    context: ServiceContext,
    id: string,
    input: z.input<typeof memberSuspensionInputSchema>,
  ) {
    return auditedOperation(
      this.audit,
      context,
      { action: "members.suspension" },
      async () => {
        const caller = requireMemberAdmin(context);
        const parsed = memberSuspensionInputSchema.parse(input);
        return membershipTransaction(this.prisma, async (tx) => {
          await lockOrganization(tx, caller);
          const member = await editableMember(tx, caller, id, parsed.suspended);
          const changed = (member.suspended ?? false) !== parsed.suspended;
          if (changed) {
            const auth = createAuth(tx, this.config);
            const native = await auth.$context;
            await native.adapter.update({
              model: "member",
              where: [
                { field: "id", value: id },
                { field: "organizationId", value: caller.organizationId },
              ],
              update: { suspended: parsed.suspended },
            });
          }
          const audit = await this.audit.write(
            context,
            {
              action: "members.suspension",
              resourceType: "member",
              resourceIds: [id],
              detail: parsed,
            },
            tx,
          );
          return { result: { id, updated: changed }, audit };
        });
      },
    );
  }

  async remove(
    context: ServiceContext,
    id: string,
    input: z.input<typeof reasonInputSchema>,
  ) {
    return auditedOperation(
      this.audit,
      context,
      { action: "members.remove" },
      async () => {
        const caller = requireMemberAdmin(context);
        const parsed = reasonInputSchema.parse(input);
        return membershipTransaction(this.prisma, async (tx) => {
          await lockOrganization(tx, caller);
          const target = await editableMember(tx, caller, id, true);
          if (
            (await tx.account.count({ where: { userId: target.userId } })) === 0
          )
            await invalidateSetupTokens(tx, target.userId);
          const native = await createAuth(tx, this.config).$context;
          await native.adapter.update({
            model: "member",
            where: [
              { field: "id", value: id },
              { field: "organizationId", value: caller.organizationId },
            ],
            update: { suspended: true, removedAt: new Date() },
          });
          const audit = await this.audit.write(
            context,
            {
              action: "members.remove",
              resourceType: "member",
              resourceIds: [id],
              detail: parsed,
            },
            tx,
          );
          return { result: { id, updated: true }, audit };
        });
      },
    );
  }
}
