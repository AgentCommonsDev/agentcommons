import { LockKeyhole } from "lucide-react";
import { useState } from "react";
import { LoadingState, RequestError } from "../../components/app/states";
import { ProviderSignIn } from "../../components/provider-sign-in";
import { Button } from "../../components/ui/button";
import { Alert, Spinner } from "../../components/ui/feedback";
import { Field } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { copy } from "../../copy";
import { authClient } from "../../lib/auth-client";
import { useBillingConfig } from "../../lib/billing-config";
import { errorMessage } from "../../lib/display";
import { paths } from "../../lib/routes";
import { useAuthConfig } from "../../lib/use-auth-config";
import {
  AccountDivider,
  AccountForm,
  AccountHeading,
  AccountLink,
  AccountLinks,
  AccountPrompt,
} from "./layout";

export function LoginPage() {
  const billing = useBillingConfig();
  const config = useAuthConfig();
  /* Hosted accounts pass through onboarding, which forwards ready users to the workspace. */
  const callbackPath = billing.enabled ? paths.onboarding : paths.home;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signIn = async () => {
    setPending(true);
    setError(null);
    try {
      /* Relative callback paths resolve against the server's public URL, so they stay valid on any dev port. */
      const response = await authClient.signIn.email({
        email,
        password,
        callbackURL: callbackPath,
      });
      if (response.error)
        throw new Error(response.error.message ?? copy.auth.signInFailed);
      window.location.assign(callbackPath);
    } catch (caught) {
      setError(errorMessage(caught));
      setPending(false);
    }
  };
  const provider = config.data
    ? config.data.oidc_enabled || config.data.social_provider
    : false;
  return (
    <>
      <AccountHeading
        icon={<LockKeyhole aria-hidden />}
        title={billing.enabled ? copy.auth.welcomeBack : copy.auth.nativeTitle}
        description={
          billing.enabled
            ? copy.signup.signInDescription
            : copy.auth.nativeDescription
        }
      />
      {config.isPending ? (
        <LoadingState rows={2} />
      ) : config.error ? (
        <RequestError
          title={copy.auth.configError}
          error={config.error}
          retry={() => {
            void config.refetch();
          }}
        />
      ) : (
        <>
          {config.data.email_password_enabled && (
            <AccountForm
              onSubmit={(event) => {
                event.preventDefault();
                void signIn();
              }}
            >
              <Field label={copy.auth.email}>
                {(props) => (
                  <Input
                    {...props}
                    data-testid="login-email"
                    type="email"
                    name="email"
                    autoComplete="username"
                    required
                    value={email}
                    onChange={(event) => {
                      setEmail(event.target.value);
                    }}
                    disabled={pending}
                  />
                )}
              </Field>
              <Field label={copy.auth.password}>
                {(props) => (
                  <Input
                    {...props}
                    data-testid="login-password"
                    type="password"
                    name="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                    }}
                    disabled={pending}
                  />
                )}
              </Field>
              <Button
                type="submit"
                data-testid="login-submit"
                className="w-full"
                disabled={pending}
              >
                {pending && <Spinner className="text-current" />}
                {pending ? copy.auth.signingIn : copy.auth.signIn}
              </Button>
            </AccountForm>
          )}
          {config.data.email_password_enabled && provider && <AccountDivider />}
          <ProviderSignIn
            config={config.data}
            callbackPath={callbackPath}
            disabled={pending}
            onError={setError}
          />
          {!config.data.email_password_enabled && !provider && (
            <Alert variant="danger">{copy.auth.noMethods}</Alert>
          )}
          {error && <Alert variant="danger">{error}</Alert>}
        </>
      )}
      {billing.enabled ? (
        <AccountLinks>
          <AccountPrompt
            text={copy.auth.noAccountYet}
            href={paths.signup}
            link={copy.auth.signupLink}
          />
          {config.data?.email_password_enabled && (
            <AccountLink href={paths.forgotPassword}>
              {copy.signup.forgot}
            </AccountLink>
          )}
          <AccountLink href={paths.verifyEmail}>
            {copy.signup.verifyEmail}
          </AccountLink>
        </AccountLinks>
      ) : (
        <p className="border-t border-line-soft pt-5 text-sm text-muted">
          {copy.auth.noAccount}
        </p>
      )}
    </>
  );
}
