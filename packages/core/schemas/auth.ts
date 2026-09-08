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
  }),
  organization: organizationSchema.nullable(),
  caller: callerContextSchema.nullable(),
  key: z
    .strictObject({ id: identityIdSchema, name: z.string().nullable() })
    .nullable(),
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
