import { z } from "zod";
import {
  callerContextSchema,
  emailSchema,
  identityIdSchema,
  organizationRoleSchema,
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
export const onboardingInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(128),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
});
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
// The native TXT proof adds a 50-character label and one dot to the domain.
export const domainInputSchema = z.strictObject({
  domain: domainNameSchema.max(202),
});
export const domainOutputSchema = z.strictObject({
  organization_id: identityIdSchema,
  domain: domainNameSchema,
  provider_id: z.string(),
  verified: z.boolean(),
  dns_record: z
    .strictObject({
      type: z.literal("TXT"),
      name: z.string(),
      value: z.string(),
    })
    .nullable(),
});
export const domainsInputSchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
  domain: z.string().trim().toLowerCase().max(253).optional(),
  verified: z.enum(["true", "false"]).optional(),
  sort: z.enum(["domain", "verified"]).default("domain"),
  order: z.enum(["asc", "desc"]).default("asc"),
});
export const domainsOutputSchema = z.strictObject({
  enabled: z.boolean(),
  items: z.array(domainOutputSchema),
  cursor: z.string().nullable(),
});
