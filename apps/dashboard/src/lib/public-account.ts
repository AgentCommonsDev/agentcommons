import { useQuery } from "@tanstack/react-query";
import { authClient } from "./auth-client";
import { api, unwrap } from "./api/client";
import { useBillingConfig } from "./billing-config";
import { copy } from "../copy";

export function usePublicAccount() {
  const billing = useBillingConfig();
  const session = useQuery({
    queryKey: ["native-session"],
    enabled: typeof window !== "undefined",
    queryFn: async () => {
      const result = await authClient.getSession();
      if (result.error)
        throw new Error(
          result.error.message ?? copy.workspace.auth.loginRequired,
        );
      return result.data;
    },
    retry: false,
    staleTime: 30_000,
  });
  const identity = useQuery({
    queryKey: ["identity"],
    enabled: !!session.data,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET("/api/v1/me", { signal })),
    retry: false,
  });
  const setup =
    identity.data &&
    ["verify_email", "create_organization", "contact_admin"].includes(
      identity.data.onboarding,
    );
  return {
    authenticated: !!session.data,
    ready: !!identity.data,
    href: session.data
      ? setup
        ? "/onboarding"
        : "/home"
      : billing.enabled
        ? "/signup"
        : "/login",
    shortLabel: session.data
      ? setup
        ? copy.signup.continueSetup
        : copy.signup.dashboardShort
      : billing.enabled
        ? copy.saas.signup
        : copy.navigation.login,
    label: session.data
      ? setup
        ? copy.signup.continueSetup
        : copy.signup.openDashboard
      : billing.enabled
        ? copy.saas.signup
        : copy.hero.primary,
  };
}
