import { OrganizationForm } from "../components/workspace/organization-form";
import { PageHeading } from "../components/workspace/primitives";
import { useBillingConfig } from "../lib/billing-config";
import { api, unwrap } from "../lib/api/client";
import { closeStreams } from "../lib/streams";
import { copy } from "../copy";
export function NewOrganizationPage() {
  const billing = useBillingConfig();
  return (
    <section className="new-organization-page">
      <PageHeading
        title={copy.signup.organizationSubmit}
        description={copy.signup.onboardingDescription}
      />
      {billing.enabled ? (
        <OrganizationForm
          onSubmit={async (input) => {
            unwrap(await api.POST("/api/v1/me/organizations", { body: input }));
            closeStreams();
            window.location.assign("/installation");
          }}
        />
      ) : (
        <p>{copy.saas.unavailable}</p>
      )}
    </section>
  );
}
