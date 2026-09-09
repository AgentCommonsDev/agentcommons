import { KeyRound } from "lucide-react";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "../../components/ui/button";
import { Alert, Spinner } from "../../components/ui/feedback";
import { Field } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { copy } from "../../copy";
import { authClient, authResult } from "../../lib/auth-client";
import { useBillingConfig } from "../../lib/billing-config";
import { errorMessage } from "../../lib/display";
import { paths, withReturn } from "../../lib/routes";
import {
  AccountForm,
  AccountHeading,
  AccountLink,
  AccountLinks,
} from "./layout";

/**
 * Sets a password from an emailed token: admin-issued setup links and SaaS password resets.
 * `next` is the application page the visitor asked for; sign-in links carry it on.
 */
export function PasswordSetupPage({
  token,
  next,
}: {
  token: string | undefined;
  next: string | undefined;
}) {
  const billing = useBillingConfig();
  const loginPath = withReturn(paths.login, next);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [mismatch, setMismatch] = useState(false);
  const reset = useMutation({
    mutationFn: async (setupToken: string) => {
      authResult(
        await authClient.resetPassword({
          token: setupToken,
          newPassword: password,
        }),
        copy.auth.setupFailed,
      );
    },
    onSuccess: () => {
      setPassword("");
      setConfirm("");
    },
  });
  const done = reset.isSuccess;
  const pending = reset.isPending;
  const submit = () => {
    if (!token) return;
    if (password !== confirm) {
      setMismatch(true);
      return;
    }
    reset.mutate(token);
  };
  return (
    <>
      <AccountHeading
        icon={<KeyRound aria-hidden />}
        title={copy.auth.passwordSetupTitle}
        description={copy.auth.passwordSetupDescription}
      />
      {done ? (
        <>
          <Alert variant="success">{copy.auth.setupDone}</Alert>
          <Button asChild className="w-full">
            <a href={loginPath}>{copy.auth.signIn}</a>
          </Button>
        </>
      ) : token ? (
        <AccountForm
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Field
            label={copy.auth.passwordManagerEmail}
            optional={copy.app.common.optional}
            hint={copy.auth.passwordManagerHint}
          >
            {(props) => (
              <Input
                {...props}
                type="email"
                name="username"
                autoComplete="username"
                disabled={pending}
              />
            )}
          </Field>
          <Field label={copy.auth.newPassword} hint={copy.auth.passwordHint}>
            {(props) => (
              <Input
                {...props}
                type="password"
                name="new-password"
                autoComplete="new-password"
                minLength={8}
                required
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setMismatch(false);
                }}
                disabled={pending}
              />
            )}
          </Field>
          <Field
            label={copy.auth.confirmPassword}
            error={mismatch ? copy.auth.passwordMismatch : undefined}
          >
            {(props) => (
              <Input
                {...props}
                type="password"
                name="confirm-password"
                autoComplete="new-password"
                minLength={8}
                required
                value={confirm}
                onChange={(event) => {
                  setConfirm(event.target.value);
                  setMismatch(false);
                }}
                disabled={pending}
              />
            )}
          </Field>
          {reset.error && (
            <Alert variant="danger">{errorMessage(reset.error)}</Alert>
          )}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending && <Spinner className="text-current" />}
            {pending ? copy.app.common.saving : copy.auth.setupSubmit}
          </Button>
        </AccountForm>
      ) : (
        <Alert variant="danger">{copy.auth.invalidSetup}</Alert>
      )}
      {!done && (
        <AccountLinks>
          <AccountLink href={loginPath}>{copy.auth.backToSignIn}</AccountLink>
          {billing.enabled && !token && (
            <AccountLink href={withReturn(paths.forgotPassword, next)}>
              {copy.site.signup.forgot}
            </AccountLink>
          )}
        </AccountLinks>
      )}
    </>
  );
}
