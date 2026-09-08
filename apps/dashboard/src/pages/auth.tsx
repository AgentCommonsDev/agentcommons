import { useState } from "react";
import { ArrowLeft, LockKeyhole } from "lucide-react";
import { copy, links } from "../copy";
import { ProviderSignIn } from "../components/provider-sign-in";
import { useBillingConfig } from "../lib/billing-config";
import { authClient } from "../lib/auth-client";
import { errorMessage } from "../lib/display";
import { Button } from "../components/ui/button";
import { Field } from "../components/workspace/primitives";
import type { AuthConfig } from "../lib/types";

export function NativeLogin({ config }: { config: AuthConfig }) {
  const billing = useBillingConfig();
  const callbackPath = billing.enabled ? "/onboarding" : "/home";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signIn = async () => {
    setPending(true);
    setError(null);
    try {
      const response = await authClient.signIn.email({
        email,
        password,
        callbackURL: new URL(callbackPath, window.location.origin).href,
      });
      if (response.error)
        throw new Error(
          response.error.message ?? copy.workspace.auth.signInFailed,
        );
      window.location.assign(callbackPath);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  };
  const provider = config.oidc_enabled ? "oidc" : config.social_provider;
  return (
    <main id="main" className="login-page container">
      <div className="login-card">
        <div className="login-icon">
          <LockKeyhole size={26} strokeWidth={1.4} aria-hidden />
        </div>
        <h1>{copy.workspace.auth.nativeTitle}</h1>
        <p>
          {billing.enabled
            ? copy.signup.signInDescription
            : copy.workspace.auth.nativeDescription}
        </p>
        {config.email_password_enabled && (
          <form
            className="auth-form"
            onSubmit={(event) => {
              event.preventDefault();
              void signIn();
            }}
          >
            <Field label={copy.workspace.auth.email}>
              {(props) => (
                <input
                  {...props}
                  type="email"
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
            <Field label={copy.workspace.auth.password}>
              {(props) => (
                <input
                  {...props}
                  type="password"
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
            <Button type="submit" disabled={pending}>
              {pending
                ? copy.workspace.auth.signingIn
                : copy.workspace.auth.signIn}
            </Button>
          </form>
        )}
        {config.email_password_enabled && provider && (
          <div className="auth-divider">{copy.workspace.auth.or}</div>
        )}
        <ProviderSignIn
          config={config}
          callbackPath={callbackPath}
          disabled={pending}
          onError={setError}
        />
        {!config.email_password_enabled && !provider && (
          <p role="alert">{copy.workspace.auth.noMethods}</p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {billing.enabled ? (
          <div className="auth-related">
            <a href="/verify-email">{copy.signup.verifyEmail}</a>
            <a href="/signup">{copy.saas.signup}</a>
            {config.email_password_enabled && (
              <a href="/forgot-password">{copy.signup.forgot}</a>
            )}
          </div>
        ) : (
          <p className="login-detail">{copy.workspace.auth.noAccount}</p>
        )}
        <a href={links.documentation} className="text-link login-back">
          <ArrowLeft size={15} aria-hidden />
          {copy.navigation.docs}
        </a>
      </div>
    </main>
  );
}
export function PasswordSetup({ token }: { token: string | undefined }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!token) return;
    if (password !== confirm) {
      setError(copy.workspace.auth.passwordMismatch);
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
        throw new Error(
          response.error.message ?? copy.workspace.auth.setupFailed,
        );
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
    <main id="main" className="login-page container">
      <div className="login-card">
        <div className="login-icon">
          <LockKeyhole size={26} aria-hidden />
        </div>
        <h1>{copy.workspace.auth.passwordSetupTitle}</h1>
        <p>{copy.workspace.auth.passwordSetupDescription}</p>
        {done ? (
          <div className="form-success" role="status">
            {copy.workspace.auth.setupDone}
          </div>
        ) : token ? (
          <form
            className="auth-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <Field
              label={copy.workspace.auth.passwordManagerEmail}
              hint={copy.workspace.auth.passwordManagerHint}
            >
              {(props) => (
                <input
                  {...props}
                  type="email"
                  name="username"
                  autoComplete="username"
                  disabled={pending}
                />
              )}
            </Field>
            <Field
              label={copy.workspace.auth.newPassword}
              hint={copy.workspace.auth.passwordHint}
            >
              {(props) => (
                <input
                  {...props}
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                  }}
                  disabled={pending}
                />
              )}
            </Field>
            <Field label={copy.workspace.auth.confirmPassword}>
              {(props) => (
                <input
                  {...props}
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                  value={confirm}
                  onChange={(event) => {
                    setConfirm(event.target.value);
                  }}
                  disabled={pending}
                />
              )}
            </Field>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <Button type="submit" disabled={pending}>
              {pending
                ? copy.workspace.common.saving
                : copy.workspace.auth.setupSubmit}
            </Button>
          </form>
        ) : (
          <p className="form-error" role="alert">
            {copy.workspace.auth.invalidSetup}
          </p>
        )}
        <Button variant="ghost" asChild>
          <a href="/login">{copy.workspace.auth.signIn}</a>
        </Button>
      </div>
    </main>
  );
}
