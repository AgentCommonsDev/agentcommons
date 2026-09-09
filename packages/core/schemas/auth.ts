import { z } from "zod";
import {
  callerContextSchema,
  createListInputSchema,
  emailSchema,
  identityIdSchema,
  organizationRoleSchema,
  paginatedOutput,
} from "./common.js";

export const organizationSchema = z.strictObject({
  id: identityIdSchema,
  name: z.string(),
  slug: z.string(),
  role: organizationRoleSchema,
});
export const organizationsOutputSchema = z.strictObject({
  organizations: z.array(organizationSchema),
  active_organization_id: identityIdSchema.nullable(),
});
export const organizationSwitchInputSchema = z.strictObject({
  organization_id: identityIdSchema,
});
export const organizationSwitchOutputSchema = z.strictObject({
  organization: organizationSchema,
});
export const meOutputSchema = z.strictObject({
  user: z.strictObject({
    id: identityIdSchema,
    email: emailSchema,
    name: z.string(),
    email_verified: z.boolean(),
  }),
  onboarding: z.enum([
    "not_applicable",
    "verify_email",
    "create_organization",
    "ready",
    "contact_admin",
  ]),
  organization: organizationSchema.nullable(),
  caller: callerContextSchema.nullable(),
  key: z
    .strictObject({ id: identityIdSchema, name: z.string().nullable() })
    .nullable(),
});
export const organizationSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
/** The slug is derived from the name when omitted; only automation needs to pin one. */
export const onboardingInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(128),
  slug: organizationSlugSchema.optional(),
});
/** Deterministic URL-safe slug from an organization name; callers add a suffix on collision. */
export function organizationSlugFromName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 48)
    .replaceAll(/-+$/g, "");
  return slug.length > 0 ? slug : "organization";
}
export const onboardingOutputSchema = z.strictObject({
  organization_id: identityIdSchema,
  created: z.boolean(),
});
export const authConfigOutputSchema = z.strictObject({
  features: z.array(z.literal("similar_sessions")).default([]),
  email_password_enabled: z.boolean(),
  social_provider: z.string().nullable(),
  oidc_enabled: z.boolean(),
  signup_mode: z.enum(["open", "invite", "closed"]),
});
export const passwordSetupInputSchema = z.strictObject({
  user_id: identityIdSchema,
});
export const passwordSetupOutputSchema = z.strictObject({
  setup_url: z.url(),
  expires_at: z.iso.datetime(),
});

const domainNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/,
  );
export const domainInputSchema = z.strictObject({
  domain: domainNameSchema,
});
export const domainOutputSchema = z.strictObject({
  organization_id: identityIdSchema,
  domain: domainNameSchema,
  provider_id: z.string(),
  verified: z.boolean(),
});
/** The shared list contract without a CSV form; the route coerces query strings. */
export const domainsInputSchema = createListInputSchema(["domain"])
  .omit({ format: true })
  .extend({
    domain: z.string().trim().toLowerCase().max(253).optional(),
    sort: z.enum(["domain"]).default("domain"),
    order: z.enum(["asc", "desc"]).default("asc"),
  });
export const domainsOutputSchema = z.strictObject({
  enabled: z.boolean(),
  ...paginatedOutput(domainOutputSchema).shape,
});

export type OnboardingState = z.infer<typeof meOutputSchema>["onboarding"];
/** Whether the account still has a hosted onboarding step to finish before the workspace opens. */
export function onboardingPending(state: OnboardingState): boolean {
  return state !== "ready" && state !== "not_applicable";
}
