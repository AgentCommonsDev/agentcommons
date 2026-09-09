import { LockKeyhole } from "lucide-react";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { QueryState } from "../../components/app/states";
import { AuthMethods } from "../../components/provider-sign-in";
import { Button } from "../../components/ui/button";
import { Spinner } from "../../components/ui/feedback";
import { Field } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { copy } from "../../copy";
import { authClient, authResult } from "../../lib/auth-client";
import { useBillingConfig } from "../../lib/billing-config";
import { paths, returnPath, withReturn } from "../../lib/routes";
import { useAuthConfig } from "../../lib/use-auth-config";
import {
  AccountForm,
  AccountHeading,
  AccountLink,
  AccountLinks,
  AccountPrompt,
} from "./layout";

/** `next` is the application page the visitor asked for before signing in, if any. */
export function LoginPage({ next }: { next: string | undefined }) {
  const billing = useBillingConfig();
  const config = useAuthConfig();
  /* Hosted accounts pass through onboarding, which forwards ready users to the requested page or the workspace. */
  const callbackPath = billing.enabled
    ? withReturn(paths.onboarding, next)
    : (returnPath(next) ?? paths.home);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const signIn = useMutation({
    mutationFn: async () => {
      /* Relative callback paths resolve against the server's public URL, so they stay valid on any dev port. */
      authResult(
        await authClient.signIn.email({
          email,
          password,
          callbackURL: callbackPath,
        }),
        copy.auth.signInFailed,
      );
      window.location.assign(callbackPath);
    },
  });
  // Success navigates away, so the form stays disabled until the new page loads.
  const pending = signIn.isPending || signIn.isSuccess;
  return (
    <>
      <AccountHeading
        icon={<LockKeyhole aria-hidden />}
        title={billing.enabled ? copy.auth.welcomeBack : copy.auth.nativeTitle}
        description={
          billing.enabled
            ? copy.site.signup.signInDescription
            : copy.auth.nativeDescription
        }
      />
      <QueryState query={config} rows={2} title={copy.auth.configError}>
        {(methods) => (
          <AuthMethods
            config={methods}
            callbackPath={callbackPath}
            toggleLabel={copy.auth.passwordInstead}
            toggleTestId="login-use-password"
            disabled={pending}
            error={signIn.error}
            passwordForm={
              <AccountForm
                onSubmit={(event) => {
                  event.preventDefault();
                  signIn.mutate();
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
            }
          />
        )}
      </QueryState>
      {billing.enabled ? (
        <AccountLinks>
          <AccountPrompt
            text={copy.auth.noAccountYet}
            href={withReturn(paths.signup, next)}
            link={copy.auth.signupLink}
          />
          {config.data?.email_password_enabled && (
            <AccountLink href={withReturn(paths.forgotPassword, next)}>
              {copy.site.signup.forgot}
            </AccountLink>
          )}
          <AccountLink href={withReturn(paths.verifyEmail, next)}>
            {copy.site.signup.verifyEmail}
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
