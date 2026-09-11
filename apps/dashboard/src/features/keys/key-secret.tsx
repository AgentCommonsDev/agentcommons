import { formatInstallCommand } from "@agentcommons/core/format/install";
import { KeyRound } from "lucide-react";
import type { ReactNode } from "react";
import { CopyButton } from "../../components/app/states";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../components/ui/card";
import { copy } from "../../copy";

/**
 * The one-time reveal of a freshly created key, with the installer command that embeds it.
 * `children` render between the key and the dismiss button: what else the caller wants
 * copied while the secret is still on screen (the management server registrations).
 */
export function KeySecretPanel({
  secret,
  onDismiss,
  showCommand = true,
  children,
}: {
  secret: string;
  onDismiss: () => void;
  showCommand?: boolean | undefined;
  children?: ReactNode;
}) {
  const command = formatInstallCommand(window.location.origin, secret);
  return (
    <Card
      data-testid="keys-secret"
      role="status"
      className="border-success/40 bg-success-bg/30"
    >
      <CardHeader className="pb-2">
        <div className="flex items-start gap-3">
          <KeyRound
            aria-hidden
            className="mt-0.5 size-5 shrink-0 text-success"
          />
          <div>
            <CardTitle>{copy.keys.secret.title}</CardTitle>
            <CardDescription>{copy.keys.secret.description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">
            {copy.keys.secret.key}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2 font-mono text-[13px] break-all select-all">
              {secret}
            </code>
            <CopyButton
              value={secret}
              label={copy.keys.secret.copyKey}
              showLabel
              variant="secondary"
            />
          </div>
        </div>
        {showCommand && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted">
              {copy.keys.secret.command}
            </span>
            <p className="text-xs leading-relaxed text-muted">
              {copy.keys.secret.commandHint}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <pre
                data-testid="install-command"
                className="m-0 min-w-0 flex-1 overflow-x-auto rounded-md border border-line bg-surface px-3 py-2 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap break-all"
              >
                <code>{command}</code>
              </pre>
              <CopyButton
                value={command}
                label={copy.keys.secret.copyCommand}
                showLabel
                variant="secondary"
              />
            </div>
          </div>
        )}
        {children}
        <div>
          <Button variant="secondary" size="sm" onClick={onDismiss}>
            {copy.keys.secret.done}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
