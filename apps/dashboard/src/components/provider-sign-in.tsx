import { useState } from "react";
import { authClient } from "../lib/auth-client";
import { errorMessage } from "../lib/display";
import type { AuthConfig } from "../lib/types";
import { copy } from "../copy";
import { Button } from "./ui/button";
export function ProviderSignIn({
  config,
  callbackPath,
  disabled = false,
  onError,
}: {
  config: AuthConfig;
  callbackPath: string;
  disabled?: boolean;
  onError: (error: string) => void;
}) {
  const [pending, setPending] = useState(false);
  const provider = config.oidc_enabled ? "oidc" : config.social_provider;
  if (!provider) return null;
  return (
    <Button
      className="auth-provider"
      variant="secondary"
      disabled={pending || disabled}
      onClick={() => {
        setPending(true);
        void authClient.signIn
          .social({
            provider,
            callbackURL: new URL(callbackPath, window.location.origin).href,
          })
          .then((response) => {
            if (response.error)
              onError(
                response.error.message ?? copy.workspace.auth.signInFailed,
              );
          })
          .catch((error: unknown) => {
            onError(errorMessage(error));
          })
          .finally(() => {
            setPending(false);
          });
      }}
    >
      {config.oidc_enabled
        ? copy.workspace.auth.sso
        : `${copy.workspace.auth.continueWith} ${provider}`}
    </Button>
  );
}
