import { LogIn, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { authClient } from "../lib/auth-client";
import { errorMessage } from "../lib/display";
import type { AuthConfig } from "../lib/types";
import { copy } from "../copy";
import { Button } from "./ui/button";
import { Spinner } from "./ui/feedback";

/** One button for the configured external sign-in: organization SSO or a social provider. */
export function ProviderSignIn({
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
          .then((response) => {
            if (response.error)
              onError(response.error.message ?? copy.auth.signInFailed);
          })
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
