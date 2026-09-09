import { Building2, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  onboardingInputSchema,
  onboardingPending,
} from "@agentcommons/core/schemas/auth";
import {
  LoadingState,
  QueryState,
  RequestError,
} from "../../components/app/states";
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
import { identityQuery } from "../../lib/api/queries";
import { authClient, authResult } from "../../lib/auth-client";
import { useBillingConfig } from "../../lib/billing-config";
import { errorMessage } from "../../lib/display";
import { paths, returnPath, withReturn } from "../../lib/routes";
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
  const create = useMutation({
    // A schema failure surfaces like a request failure: `errorMessage` reads both.
    mutationFn: () =>
      onSubmit({ name: onboardingInputSchema.parse({ name }).name }),
  });
  /* Success navigates away, so the button stays disabled until the new page loads. */
  const pending = create.isPending || create.isSuccess;
  return (
    <AccountForm
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate();
      }}
    >
      <Field
        label={copy.site.signup.organizationName}
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
      {create.error && (
        <Alert variant="danger">{errorMessage(create.error)}</Alert>
      )}
      <Button
        type="submit"
        data-testid="onboarding-submit"
        className={cn("w-full", submitClassName)}
        disabled={pending}
      >
        {pending && <Spinner className="text-current" />}
        {pending
          ? copy.site.signup.organizationPending
          : copy.site.signup.organizationSubmit}
      </Button>
    </AccountForm>
  );
}

/**
 * Hosted-mode gate between sign-in and the workspace: verify, create an organization, or
 * wait. `next` is the application page the visitor asked for; a ready account opens it.
 */
export function OnboardingPage({ next }: { next: string | undefined }) {
  const billing = useBillingConfig();
  const [operationError, setOperationError] = useState<unknown>(null);
  const me = useQuery({ ...identityQuery, enabled: billing.enabled });
  const unauthenticated =
    me.error instanceof ApiError && me.error.status === 401;
  const ready = me.data !== undefined && !onboardingPending(me.data.onboarding);
  const requested = returnPath(next);
  const destination = requested ?? paths.home;
  useEffect(() => {
    if (unauthenticated) window.location.replace(withReturn(paths.login, next));
    else if (ready) window.location.replace(destination);
  }, [unauthenticated, ready, next, destination]);
  if (!billing.enabled)
    return <AccountUnavailable title={copy.site.signup.onboardingTitle} />;
  const signOut = async () => {
    setOperationError(null);
    authResult(await authClient.signOut(), copy.app.common.requestFailed);
    window.location.assign(paths.login);
  };
  return (
    <>
      {unauthenticated ? (
        <LoadingState rows={2} />
      ) : (
        <QueryState query={me} rows={2}>
          {(account) =>
            account.onboarding === "verify_email" ? (
              <VerificationNotice email={account.user.email} next={next} />
            ) : account.onboarding === "create_organization" ? (
              <>
                <AccountHeading
                  icon={<Building2 aria-hidden />}
                  title={copy.site.signup.onboardingTitle}
                  description={copy.site.signup.onboardingDescription}
                />
                <OrganizationForm
                  onSubmit={async (input) => {
                    unwrap(
                      await api.POST("/api/v1/onboarding", { body: input }),
                    );
                    /* New organizations start on Install unless a page was asked for. */
                    window.location.assign(requested ?? paths.install);
                  }}
                />
                <AccountAgreement />
                <p className="text-xs leading-relaxed text-subtle">
                  {copy.auth.onboardingNext}
                </p>
              </>
            ) : account.onboarding === "contact_admin" ? (
              <AccountHeading
                icon={<ShieldAlert aria-hidden />}
                title={copy.site.signup.contactTitle}
                description={copy.site.signup.contactDescription}
              />
            ) : (
              <>
                <AccountHeading title={copy.auth.redirecting} />
                <Button asChild className="w-full">
                  <a href={destination}>{copy.site.signup.continue}</a>
                </Button>
              </>
            )
          }
        </QueryState>
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
              <CardTitle>{copy.site.signup.organizationSubmit}</CardTitle>
              <CardDescription>
                {copy.site.signup.onboardingDescription}
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
          title={copy.site.saas.unavailable}
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
