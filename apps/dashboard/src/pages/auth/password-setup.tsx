import { KeyRound } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Alert, Spinner } from "../../components/ui/feedback";
import { Field } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { copy } from "../../copy";
import { authClient } from "../../lib/auth-client";
import { useBillingConfig } from "../../lib/billing-config";
import { errorMessage } from "../../lib/display";
import { paths } from "../../lib/routes";
import {
  AccountForm,
  AccountHeading,
  AccountLink,
  AccountLinks,
} from "./layout";

/** Sets a password from an emailed token: admin-issued setup links and SaaS password resets. */
export function PasswordSetupPage({ token }: { token: string | undefined }) {
  const billing = useBillingConfig();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [mismatch, setMismatch] = useState(false);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!token) return;
    if (password !== confirm) {
      setMismatch(true);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await authClient.resetPassword({
        token,
        newPassword: password,
      });
      if (response.error)
        throw new Error(response.error.message ?? copy.auth.setupFailed);
      setDone(true);
      setPassword("");
      setConfirm("");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
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
            <a href={paths.login}>{copy.auth.signIn}</a>
          </Button>
        </>
      ) : token ? (
        <AccountForm
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
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
          {error && <Alert variant="danger">{error}</Alert>}
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
          <AccountLink href={paths.login}>{copy.auth.backToSignIn}</AccountLink>
          {billing.enabled && !token && (
            <AccountLink href={paths.forgotPassword}>
              {copy.signup.forgot}
            </AccountLink>
          )}
        </AccountLinks>
      )}
    </>
  );
}
