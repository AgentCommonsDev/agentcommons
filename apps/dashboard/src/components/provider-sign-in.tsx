import { LogIn, ShieldCheck } from "lucide-react";
import { useState, type ReactNode } from "react";
import { authClient, authResult } from "../lib/auth-client";
import { errorMessage } from "../lib/display";
import type { AuthConfig } from "../lib/types";
import { copy } from "../copy";
import { Button } from "./ui/button";
import { Alert, Spinner } from "./ui/feedback";

/** One button for the configured external sign-in: organization SSO or a social provider. */
function ProviderSignIn({
  config,
  callbackPath,
  disabled = false,
  onError,
}: {
  config: AuthConfig;
  callbackPath: string;
  disabled?: boolean | undefined;
  onError: (error: string) => void;
}) {
  const [pending, setPending] = useState(false);
  const provider = config.oidc_enabled ? "oidc" : config.social_provider;
  if (!provider) return null;
  const providerNames: Record<string, string> = copy.auth.providers;
  const label = config.oidc_enabled
    ? copy.auth.sso
    : `${copy.auth.continueWith} ${providerNames[provider] ?? provider}`;
  const Icon = config.oidc_enabled ? ShieldCheck : LogIn;
  return (
    <Button
      variant="secondary"
      className="w-full"
      disabled={pending || disabled}
      onClick={() => {
        setPending(true);
        void authClient.signIn
          .social({
            provider,
            callbackURL: callbackPath,
          })
          .then((response) => authResult(response, copy.auth.signInFailed))
          .catch((error: unknown) => {
            onError(errorMessage(error));
          })
          .finally(() => {
            setPending(false);
          });
      }}
    >
      {pending ? <Spinner className="text-current" /> : <Icon aria-hidden />}
      {label}
    </Button>
  );
}
/**
 * The sign-in and sign-up methods an instance offers, in one order: the external
 * provider first when configured, the password form one click away, and one alert when
 * neither exists. The page supplies the form and reports its own request errors.
 */
export function AuthMethods({
  config,
  callbackPath,
  passwordForm,
  toggleLabel,
  toggleTestId,
  disabled = false,
  error,
  children,
}: {
  config: AuthConfig;
  callbackPath: string;
  passwordForm: ReactNode;
  /** Shown while the provider is offered; the reverse label comes from shared copy. */
  toggleLabel: string;
  toggleTestId: string;
  disabled?: boolean | undefined;
  /** The page's own failure, shown with the same alert as a provider failure. */
  error?: unknown;
  /** Shown once a method exists, such as the terms agreement on signup. */
  children?: ReactNode;
}) {
  const [usePassword, setUsePassword] = useState(false);
  const [providerError, setProviderError] = useState<string | null>(null);
  const provider = config.oidc_enabled || config.social_provider;
  const passwordEnabled = config.email_password_enabled;
  const showPassword = passwordEnabled && (!provider || usePassword);
  const showProvider = Boolean(provider) && !usePassword;
  const shown =
    error !== undefined && error !== null ? errorMessage(error) : providerError;
  return (
    <>
      {showPassword && passwordForm}
      {showProvider && (
        <ProviderSignIn
          config={config}
          callbackPath={callbackPath}
          disabled={disabled}
          onError={setProviderError}
        />
      )}
      {passwordEnabled && provider && (
        <Button
          type="button"
          variant="link"
          size="sm"
          data-testid={toggleTestId}
          className="self-center"
          disabled={disabled}
          onClick={() => {
            setUsePassword((prior) => !prior);
          }}
        >
          {usePassword ? copy.auth.providerInstead : toggleLabel}
        </Button>
      )}
      {!passwordEnabled && !provider && (
        <Alert variant="danger">{copy.auth.noMethods}</Alert>
      )}
      {shown && <Alert variant="danger">{shown}</Alert>}
      {(passwordEnabled || provider) && children}
    </>
  );
}
