import { auditedOperation } from "./audit.js";
import { z } from "zod";
import {
  memberAddInputSchema,
  memberAddOutputSchema,
  membersInputSchema,
  membersOutputSchema,
  memberRoleInputSchema,
  memberSchema,
  memberSuspensionInputSchema,
  reasonInputSchema,
  passwordSetupOutputSchema,
  type CallerContext,
} from "@agentcommons/core/schemas";
import { Prisma, type PrismaClient, type Member } from "@agentcommons/db";
import {
  createAuth,
  passwordSetupUrl,
  type AuthConfiguration,
  type NativeAuth,
  type PasswordDelivery,
  PASSWORD_SETUP_SECONDS,
} from "../auth/config.js";
import { membershipTransaction } from "../auth/transaction.js";
import { invalidateSetupTokens } from "../auth/setup-tokens.js";
import { domainRequiresSso } from "../auth/sso.js";
import type { AuditService } from "./audit.js";
import { lockOrganization, requireCookie } from "./auth.js";
import { CursorCodec } from "./cursor.js";
import {
  requirePermission,
  ServiceError,
  type ServiceContext,
} from "./context.js";
import { offsetPage, wireValue } from "./read-budget.js";

/** The list's sort keys as columns of the member statement's inner select. */
const memberSort: Record<
  NonNullable<z.infer<typeof membersInputSchema>["sort"]>,
  string
> = {
  email: "email",
  name: "name",
  role: "role",
  suspended: "suspended",
  created_at: "created_at",
  last_seen_at: "last_seen_at",
};
/** A member row as PostgreSQL returns it, before dates become wire strings. */
const memberRowSchema = memberSchema.extend({
  created_at: z.date(),
  last_seen_at: z.date().nullable(),
});

function requireMemberAdmin(context: ServiceContext): CallerContext {
  requireCookie(context);
  return requirePermission(context, "admin");
}

/** Membership rows change through the native adapter; role changes use the native endpoint. */
async function updateMember(
  auth: NativeAuth,
  organizationId: string,
  id: string,
  update: { role?: string; suspended?: boolean; removedAt?: Date | null },
): Promise<void> {
  const native = await auth.$context;
  await native.adapter.update({
    model: "member",
    where: [
      { field: "id", value: id },
      { field: "organizationId", value: organizationId },
    ],
    update,
  });
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
        const binding = wireValue({
          organizationId: caller.organizationId,
          operation: "members",
          input: query,
        });
        const f = parsed.filters;
        const conditions = [
          ...(f.email === undefined
            ? []
            : [Prisma.sql`u.email=${f.email.toLowerCase()}`]),
          ...(f.role === undefined ? [] : [Prisma.sql`m.role=${f.role}`]),
          ...(f.suspended === undefined
            ? []
            : [Prisma.sql`coalesce(m.suspended,false)=${f.suspended}`]),
        ];
        const order = Prisma.raw(
          `${memberSort[parsed.sort ?? "created_at"]} ${parsed.order === "asc" ? "ASC" : "DESC"} NULLS LAST`,
        );
        const page = await offsetPage(
          this.cursors,
          binding,
          cursor,
          parsed.limit,
          (skip, take) =>
            this.members(
              caller,
              conditions,
              Prisma.sql`ORDER BY ${order},id LIMIT ${take} OFFSET ${skip}`,
            ),
        );
        const result = membersOutputSchema.parse({
          items: page.items,
          cursor: page.cursor,
        });
        const audit = await this.audit.write(context, {
          action: "members.list",
          resourceType: "member",
          detail: { ...query, row_count: page.items.length },
        });
        return { result, audit };
      },
    );
  }

  /** One member of the caller's organization by membership id, with the same fields as the list. */
  async get(context: ServiceContext, id: string) {
    return auditedOperation(
      this.audit,
      context,
      { action: "members.get" },
      async () => {
        const caller = requirePermission(context, "admin");
        const [member] = await this.members(
          caller,
          [Prisma.sql`m.id=${id}`],
          Prisma.sql`LIMIT 1`,
        );
        if (!member)
          throw new ServiceError(404, "NOT_FOUND", "Member not found.");
        const result = memberSchema.parse(member);
        const audit = await this.audit.write(context, {
          action: "members.get",
          resourceType: "member",
          resourceIds: [id],
        });
        return { result, audit };
      },
    );
  }

  /**
   * Current members of the caller's organization in one statement. `last_seen_at` is the
   * newest audit event the member made through a dashboard (cookie) principal in this
   * organization: a correlated newest-first probe of the
   * `(organization_id, auth_method, user_id, ts)` index per row, so a member whose keys
   * upload all day costs the same as one who never signed in. Sorting by it evaluates the
   * probe once per member, which is bounded by the organization's size, not its audit log.
   */
  private async members(
    caller: CallerContext,
    conditions: readonly Prisma.Sql[],
    tail: Prisma.Sql,
  ): Promise<z.infer<typeof memberSchema>[]> {
    const where = Prisma.join(
      [
        Prisma.sql`m."organizationId"=${caller.organizationId}`,
        Prisma.sql`m."removedAt" IS NULL`,
        ...conditions,
      ],
      " AND ",
    );
    return memberRowSchema
      .array()
      .parse(
        await this.prisma.$queryRaw(
          Prisma.sql`SELECT * FROM (SELECT m.id,m."organizationId" AS organization_id,m."userId" AS user_id,u.email,u.name,m.role,coalesce(m.suspended,false) AS suspended,m."createdAt" AS created_at,(SELECT a.ts FROM audit_event a WHERE a.organization_id=m."organizationId" AND a.auth_method='cookie' AND a.user_id=m."userId" ORDER BY a.ts DESC LIMIT 1) AS last_seen_at FROM member m JOIN "user" u ON u.id=m."userId" WHERE ${where}) rows ${tail}`,
        ),
      )
      .map((row) => ({
        ...row,
        created_at: row.created_at.toISOString(),
        last_seen_at: row.last_seen_at?.toISOString() ?? null,
      }));
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
        const emails = parsed.emails.map((email) => email.toLowerCase());
        return membershipTransaction(this.prisma, async (tx) => {
          await lockOrganization(tx, caller);
          const deliveries = new Map<string, PasswordDelivery>();
          const auth = createAuth(tx, this.config, (delivery) =>
            deliveries.set(delivery.userId, delivery),
          );
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM "user" WHERE email IN (${Prisma.join(emails)}) ORDER BY id FOR UPDATE`,
          );
          // One lookup per table for the whole batch; the loop below keeps the maps
          // current so an address repeated in one request reads as existing.
          const users = new Map<string, { id: string }>(
            (
              await tx.user.findMany({
                where: { email: { in: emails } },
                select: { id: true, email: true },
              })
            ).map((user) => [user.email, user]),
          );
          const userIds = [...users.values()].map((user) => user.id);
          const members = new Map<
            string,
            { id: string; removedAt: Date | null }
          >(
            userIds.length
              ? (
                  await tx.member.findMany({
                    where: {
                      userId: { in: userIds },
                      organizationId: caller.organizationId,
                    },
                    select: { id: true, userId: true, removedAt: true },
                  })
                ).map((member) => [member.userId, member])
              : [],
          );
          const claimed = new Set(
            userIds.length
              ? (
                  await tx.account.findMany({
                    where: { userId: { in: userIds } },
                    select: { userId: true },
                    distinct: ["userId"],
                  })
                ).map((account) => account.userId)
              : [],
          );
          const elsewhere = new Set(
            userIds.length
              ? (
                  await tx.member.findMany({
                    where: {
                      userId: { in: userIds },
                      organizationId: { not: caller.organizationId },
                      removedAt: null,
                    },
                    select: { userId: true },
                    distinct: ["userId"],
                  })
                ).map((member) => member.userId)
              : [],
          );
          const results: z.infer<typeof memberAddOutputSchema>["results"] = [];
          const memberIds: string[] = [];
          for (const email of emails) {
            const existing = users.get(email);
            const current = existing ? members.get(existing.id) : undefined;
            if (current && !current.removedAt) {
              results.push({
                email,
                status: "existing",
                user_id: existing?.id ?? null,
                setup_url: null,
                error: null,
              });
              continue;
            }
            if (
              existing &&
              !claimed.has(existing.id) &&
              elsewhere.has(existing.id)
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
              await updateMember(auth, caller.organizationId, current.id, {
                role: parsed.role,
                suspended: false,
                removedAt: null,
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
            users.set(email, user);
            members.set(user.id, { id: member.id, removedAt: null });
            memberIds.push(member.id);
            // No password setup link when the member's domain requires SSO (ADR 0093):
            // that address can only sign in through the organization's provider.
            if (
              !existing &&
              this.config.emailPasswordEnabled &&
              !(await domainRequiresSso(tx, email))
            )
              await auth.api.requestPasswordReset({
                body: { email, redirectTo: passwordSetupUrl(this.config) },
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
              detail: { emails, role: parsed.role, added: memberIds.length },
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
              redirectTo: passwordSetupUrl(this.config),
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
          // Role changes go through the native endpoint so Better Auth applies its own
          // role authorization to the calling session.
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
          if (changed)
            await updateMember(
              createAuth(tx, this.config),
              caller.organizationId,
              id,
              { suspended: parsed.suspended },
            );
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
          await updateMember(
            createAuth(tx, this.config),
            caller.organizationId,
            id,
            { suspended: true, removedAt: new Date() },
          );
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
