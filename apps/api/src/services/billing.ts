import {
  billingConfigSchema,
  billingCheckoutSchema,
  type PaidPlan,
  billingUsageSchema,
  billingRedirectSchema,
} from "@agentcommons/core";
import type { PrismaClient } from "@agentcommons/db";
import { nativeCheckout, nativeBillingPortal } from "../auth/billing.js";
import type { AuthConfiguration } from "../auth/config.js";
import {
  billingUsage,
  type BillingConfiguration,
} from "../repositories/billing.js";
import { lockOrganization } from "./auth.js";
import type { AuditService } from "./audit.js";
import { readOperation } from "./read-operation.js";
import { mutationOperation } from "./mutation.js";
import type { ServiceContext } from "./context.js";

export class BillingService {
  constructor(
    private readonly dependencies: {
      prisma: PrismaClient;
      audit: AuditService;
      configuration: BillingConfiguration;
      auth: AuthConfiguration;
    },
  ) {}

  /** Immutable public values also feed the server-rendered landing page. */
  publicConfig() {
    const config = this.dependencies.configuration;
    return billingConfigSchema.parse({
      mode: config.mode,
      enabled: config.mode === "saas",
      plans: {
        free: { monthly_records: config.freeMonthlyRecords },
        pro: {
          included_records: config.proIncludedRecords,
          capture_usd_per_1000:
            config.captureCentsPer1000 === null
              ? null
              : config.captureCentsPer1000 / 100,
        },
        embeddings: {
          messages_usd_per_1000:
            config.embeddingCentsPer1000 === null
              ? null
              : config.embeddingCentsPer1000 / 100,
        },
      },
      checkout_enabled:
        config.mode === "saas" && Boolean(this.dependencies.auth.stripe),
      cal_com_url: config.calComUrl,
    });
  }

  async configuration(context: ServiceContext) {
    const result = this.publicConfig();
    const audit = await this.dependencies.audit.write(context, {
      action: "billing.configuration",
    });
    return { result, audit };
  }

  usage(context: ServiceContext) {
    return readOperation(
      this.dependencies.audit,
      context,
      { action: "billing.usage", resourceType: "organization" },
      async (caller) => {
        const config = this.publicConfig();
        return this.dependencies.prisma.$transaction(async (tx) => {
          await lockOrganization(tx, caller);
          const usage = await billingUsage(
            tx,
            this.dependencies.configuration,
            caller.organizationId,
            new Date(),
          );
          const organization = await tx.organization.findUniqueOrThrow({
            where: { id: caller.organizationId },
            select: { stripeCustomerId: true },
          });
          return billingUsageSchema.parse({
            ...usage,
            can_manage:
              config.enabled &&
              caller.role === "owner" &&
              caller.authMethod === "cookie",
            checkout_enabled: config.checkout_enabled,
            portal_enabled:
              config.checkout_enabled && Boolean(organization.stripeCustomerId),
            cal_com_url: config.cal_com_url,
          });
        });
      },
    );
  }

  checkout(context: ServiceContext, input: unknown) {
    return this.finance(context, "checkout", input);
  }

  portal(context: ServiceContext) {
    return this.finance(context, "portal");
  }

  private finance(
    context: ServiceContext,
    action: "checkout" | "portal",
    input?: unknown,
  ) {
    return mutationOperation(
      this.dependencies,
      context,
      "admin",
      { action: `billing.${action}`, resourceType: "organization" },
      async (tx, caller) => {
        const plan: PaidPlan | undefined =
          action === "checkout"
            ? billingCheckoutSchema.parse(input).plan
            : undefined;
        const result = plan
          ? await nativeCheckout(tx, this.dependencies.auth, context, plan)
          : await nativeBillingPortal(tx, this.dependencies.auth, context);
        return {
          result: billingRedirectSchema.parse(result),
          resourceIds: [caller.organizationId],
        };
      },
    );
  }
}
