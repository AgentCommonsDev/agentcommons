import { useQuery } from "@tanstack/react-query";
import { onboardingPending } from "@agentcommons/core/schemas/auth";
import { authClient, authResult } from "./auth-client";
import { identityQuery } from "./api/queries";
import { useBillingConfig } from "./billing-config";
import { copy } from "../copy";
import { paths } from "./routes";

type AccountState = "setup" | "signedIn" | "signup" | "login";
/** Where the header button sends a visitor, by account state. */
const accountActions: Record<
  AccountState,
  { href: string; shortLabel: string; label: string }
> = {
  setup: {
    href: paths.onboarding,
    shortLabel: copy.site.signup.continueSetup,
    label: copy.site.signup.continueSetup,
  },
  signedIn: {
    href: paths.home,
    shortLabel: copy.site.signup.dashboardShort,
    label: copy.site.signup.openDashboard,
  },
  signup: {
    href: paths.signup,
    shortLabel: copy.site.saas.signup,
    label: copy.site.saas.signup,
  },
  login: {
    href: paths.login,
    shortLabel: copy.site.navigation.login,
    label: copy.site.hero.primary,
  },
};
export function usePublicAccount() {
  const billing = useBillingConfig();
  const session = useQuery({
    queryKey: ["native-session"],
    enabled: typeof window !== "undefined",
    queryFn: async () =>
      authResult(await authClient.getSession(), copy.auth.loginRequired),
    retry: false,
    staleTime: 30_000,
  });
  const identity = useQuery({ ...identityQuery, enabled: !!session.data });
  const state: AccountState = session.data
    ? identity.data && onboardingPending(identity.data.onboarding)
      ? "setup"
      : "signedIn"
    : billing.enabled
      ? "signup"
      : "login";
  return {
    authenticated: !!session.data,
    ready: !!identity.data,
    ...accountActions[state],
  };
}
