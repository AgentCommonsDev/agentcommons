import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { copy } from "../copy";
import { api, ApiError, unwrap } from "../lib/api/client";
import { authClient } from "../lib/auth-client";
import { useBillingConfig } from "../lib/billing-config";
import { Button } from "../components/ui/button";
import { LoadingState, RequestError } from "../components/workspace/primitives";
import { OrganizationForm } from "../components/workspace/organization-form";
import { VerificationNotice } from "./signup";
export function OnboardingPage() {
  const billing = useBillingConfig();
  const [error, setError] = useState<unknown>(null);
  const me = useQuery({
    queryKey: ["identity"],
    enabled: billing.enabled,
    retry: false,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET("/api/v1/me", { signal })),
  });
  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401)
      window.location.replace("/login");
    if (me.data?.onboarding === "ready") window.location.replace("/home");
  }, [me.error, me.data]);
  return (
    <main id="main" className="login-page container">
      <div className="login-card">
        {!billing.enabled ? (
          <>
            <h1>{copy.signup.onboardingTitle}</h1>
            <p>{copy.saas.unavailable}</p>
          </>
        ) : me.isPending ? (
          <LoadingState />
        ) : me.error ? (
          <RequestError
            error={me.error}
            retry={() => {
              void me.refetch();
            }}
          />
        ) : me.data.onboarding === "verify_email" ? (
          <VerificationNotice email={me.data.user.email} />
        ) : me.data.onboarding === "create_organization" ? (
          <>
            <h1>{copy.signup.onboardingTitle}</h1>
            <p>{copy.signup.onboardingDescription}</p>
            <OrganizationForm
              onSubmit={async (input) => {
                unwrap(await api.POST("/api/v1/onboarding", { body: input }));
                window.location.assign("/home");
              }}
            />
          </>
        ) : me.data.onboarding === "contact_admin" ? (
          <>
            <h1>{copy.signup.contactTitle}</h1>
            <p>{copy.signup.contactDescription}</p>
          </>
        ) : (
          <a href="/home">{copy.signup.continue}</a>
        )}
        {error !== null && <RequestError error={error} />}
        {me.data && (
          <Button
            className="login-back"
            variant="ghost"
            onClick={() => {
              void authClient
                .signOut()
                .then((response) => {
                  if (response.error)
                    throw new Error(
                      response.error.message ??
                        copy.workspace.common.requestFailed,
                    );
                  window.location.assign("/login");
                })
                .catch(setError);
            }}
          >
            {copy.workspace.navigation.signOut}
          </Button>
        )}
      </div>
    </main>
  );
}
