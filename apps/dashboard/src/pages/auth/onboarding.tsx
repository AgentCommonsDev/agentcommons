import { Building2, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { onboardingInputSchema } from "@agentcommons/core/schemas/auth";
import { LoadingState, RequestError } from "../../components/app/states";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import {
  Alert,
  EmptyState,
  PageHeader,
  Spinner,
} from "../../components/ui/feedback";
import { Field } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { copy } from "../../copy";
import { api, ApiError, unwrap } from "../../lib/api/client";
import { authClient } from "../../lib/auth-client";
import { useBillingConfig } from "../../lib/billing-config";
import { errorMessage } from "../../lib/display";
import { paths } from "../../lib/routes";
import { closeStreams } from "../../lib/streams";
import { cn } from "../../lib/utils";
import {
  AccountAgreement,
  AccountForm,
  AccountHeading,
  AccountLinks,
  AccountUnavailable,
} from "./layout";
import { VerificationNotice } from "./signup";

/** Name-only organization form; the server derives the URL slug from the name. */
function OrganizationForm({
  onSubmit,
  submitClassName,
}: {
  onSubmit: (input: { name: string }) => Promise<void>;
  submitClassName?: string | undefined;
}) {
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <AccountForm
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const input = onboardingInputSchema.safeParse({ name });
        if (!input.success) {
          setError(input.error);
          return;
        }
        setPending(true);
        /* Success navigates away, so the button stays disabled until the new page loads. */
        void onSubmit({ name: input.data.name }).catch((caught: unknown) => {
          setError(caught);
          setPending(false);
        });
      }}
    >
      <Field
        label={copy.signup.organizationName}
        hint={copy.auth.organizationNameHint}
      >
        {(props) => (
          <Input
            {...props}
            data-testid="onboarding-organization-name"
            name="organization"
            autoComplete="organization"
            required
            maxLength={onboardingInputSchema.shape.name.maxLength ?? undefined}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
            disabled={pending}
          />
        )}
      </Field>
      {error !== null && <Alert variant="danger">{errorMessage(error)}</Alert>}
      <Button
        type="submit"
        data-testid="onboarding-submit"
        className={cn("w-full", submitClassName)}
        disabled={pending}
      >
        {pending && <Spinner className="text-current" />}
        {pending
          ? copy.signup.organizationPending
          : copy.signup.organizationSubmit}
      </Button>
    </AccountForm>
  );
}

/** Hosted-mode gate between sign-in and the workspace: verify, create an organization, or wait. */
export function OnboardingPage() {
  const billing = useBillingConfig();
  const [operationError, setOperationError] = useState<unknown>(null);
  const me = useQuery({
    queryKey: ["identity"],
    enabled: billing.enabled,
    retry: false,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET("/api/v1/me", { signal })),
  });
  const unauthenticated =
    me.error instanceof ApiError && me.error.status === 401;
  const ready =
    me.data?.onboarding === "ready" || me.data?.onboarding === "not_applicable";
  useEffect(() => {
    if (unauthenticated) window.location.replace(paths.login);
    else if (ready) window.location.replace(paths.home);
  }, [unauthenticated, ready]);
  if (!billing.enabled)
    return <AccountUnavailable title={copy.signup.onboardingTitle} />;
  const signOut = async () => {
    setOperationError(null);
    const response = await authClient.signOut();
    if (response.error)
      throw new Error(response.error.message ?? copy.app.common.requestFailed);
    window.location.assign(paths.login);
  };
  return (
    <>
      {me.isPending || unauthenticated ? (
        <LoadingState rows={2} />
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
          <AccountHeading
            icon={<Building2 aria-hidden />}
            title={copy.signup.onboardingTitle}
            description={copy.signup.onboardingDescription}
          />
          <OrganizationForm
            onSubmit={async (input) => {
              unwrap(await api.POST("/api/v1/onboarding", { body: input }));
              window.location.assign(paths.install);
            }}
          />
          <AccountAgreement />
          <p className="text-xs leading-relaxed text-subtle">
            {copy.auth.onboardingNext}
          </p>
        </>
      ) : me.data.onboarding === "contact_admin" ? (
        <AccountHeading
          icon={<ShieldAlert aria-hidden />}
          title={copy.signup.contactTitle}
          description={copy.signup.contactDescription}
        />
      ) : (
        <>
          <AccountHeading title={copy.auth.redirecting} />
          <Button asChild className="w-full">
            <a href={paths.home}>{copy.signup.continue}</a>
          </Button>
        </>
      )}
      {operationError !== null && <RequestError error={operationError} />}
      {me.data && (
        <AccountLinks>
          <p className="flex min-w-0 flex-wrap gap-x-1.5 text-muted">
            <span>{copy.auth.signedInAs}</span>
            <span className="min-w-0 font-medium break-all text-fg">
              {me.data.user.email}
            </span>
          </p>
          <Button
            variant="link"
            className="h-auto self-start px-0 text-sm sm:ml-auto"
            onClick={() => {
              void signOut().catch(setOperationError);
            }}
          >
            {copy.app.navigation.signOut}
          </Button>
        </AccountLinks>
      )}
    </>
  );
}

/** Inside the app shell: a second (or later) organization for a hosted account. */
export function NewOrganizationPage() {
  const billing = useBillingConfig();
  return (
    <>
      <PageHeader
        title={copy.app.navigation.newOrganization}
        description={copy.auth.newOrganizationDescription}
      />
      {billing.enabled ? (
        <Card className="max-w-lg">
          <CardHeader>
            <div className="min-w-0">
              <CardTitle>{copy.signup.organizationSubmit}</CardTitle>
              <CardDescription>
                {copy.signup.onboardingDescription}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <OrganizationForm
              submitClassName="sm:w-auto sm:self-start"
              onSubmit={async (input) => {
                const created = unwrap(
                  await api.POST("/api/v1/me/organizations", { body: input }),
                );
                closeStreams();
                unwrap(
                  await api.POST("/api/v1/me/organization", {
                    body: { organization_id: created.organization_id },
                  }),
                );
                window.location.assign(paths.install);
              }}
            />
          </CardContent>
        </Card>
      ) : (
        <EmptyState
          icon={<Building2 aria-hidden />}
          title={copy.saas.unavailable}
          description={copy.auth.noAccount}
          action={
            <Button asChild variant="secondary">
              <a href={paths.home}>{copy.app.navigation.backHome}</a>
            </Button>
          }
        />
      )}
    </>
  );
}
