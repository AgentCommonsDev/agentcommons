import {
  admin,
  genericOAuth,
  openAPI,
  organization,
} from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access";
import { apiKey } from "@better-auth/api-key";
import { sso } from "@better-auth/sso";

/** The digest Better Auth stores in `apikey.key`; identity resolution confirms a negative lookup with it. */
export { defaultKeyHasher } from "@better-auth/api-key";
import { stripe } from "@better-auth/stripe";

const keyActions = ["create", "read", "update", "delete"] as const;
const organizationAccess = createAccessControl({
  ...defaultStatements,
  apiKey: keyActions,
});
const organizationRoles = {
  owner: organizationAccess.newRole({
    ...ownerAc.statements,
    apiKey: keyActions,
  }),
  admin: organizationAccess.newRole({
    ...adminAc.statements,
    apiKey: keyActions,
  }),
  member: organizationAccess.newRole({
    ...memberAc.statements,
    apiKey: keyActions,
  }),
};

type OAuthProviders = Parameters<typeof genericOAuth>[0]["config"];
type StripeOptions = Parameters<typeof stripe>[0];
export type NativeStripeOptions = StripeOptions & {
  subscription: Extract<
    NonNullable<StripeOptions["subscription"]>,
    { enabled: true }
  >;
};
export const authUserFields = {
  onboardingOrganizationId: { type: "string", required: false, input: false },
  welcomeQueuedAt: { type: "date", required: false, input: false },
} as const;

// Native endpoints remain behind services, which enforce issuer ownership and
// organization scope before using these library-defined role permissions.
export const authPlugins = (
  oauthProviders: OAuthProviders = [],
  domainProvisioning = false,
  billing?: NativeStripeOptions,
) => [
  admin(),
  organization({
    allowUserToCreateOrganization: false,
    disableOrganizationDeletion: true,
    membershipLimit: Number.MAX_SAFE_INTEGER,
    ac: organizationAccess,
    roles: organizationRoles,
    schema: {
      member: {
        additionalFields: {
          suspended: {
            type: "boolean",
            required: false,
            defaultValue: false,
            input: false,
          },
          removedAt: {
            type: "date",
            required: false,
            input: false,
          },
        },
      },
    },
  }),
  apiKey({
    defaultPrefix: "ac_",
    references: "organization",
    maximumNameLength: 128,
    keyExpiration: { minExpiresIn: 1 / 86400, maxExpiresIn: 365 },
    rateLimit: { enabled: false },
  }),
  genericOAuth({ config: oauthProviders }),
  sso({
    domainVerification: { enabled: true },
    organizationProvisioning: {
      disabled: !domainProvisioning,
      defaultRole: "member",
    },
  }),
  ...(billing ? [stripe(billing)] : []),
  openAPI(),
];
