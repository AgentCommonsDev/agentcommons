import {
  managementPermissions,
  managementRegistrations,
} from "@agentcommons/core/format/mcp-registration";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { CodeBlock } from "../../components/app/markdown";
import { RequestError } from "../../components/app/states";
import { useWorkspace } from "../../components/app/workspace";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { Alert } from "../../components/ui/feedback";
import { Field } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { copy } from "../../copy";
import { harnessLabel } from "../../lib/display";
import { KeySecretPanel } from "../keys/key-secret";
import { createPersonalKey, useRefreshKeys } from "../keys/queries";

const text = copy.admin.mcp;

/** The `agentcommons-admin` entry for each MCP-capable harness, with the key in it. */
function Registrations({ secret }: { secret: string }) {
  return (
    <div
      className="flex flex-col gap-4 border-t border-line-soft pt-4"
      data-testid="management-registrations"
    >
      <div>
        <p className="text-sm font-medium">{text.register.title}</p>
        <p className="text-xs leading-relaxed text-muted">
          {text.register.description}
        </p>
      </div>
      {managementRegistrations(window.location.origin, secret).map(
        (registration) => {
          const harness = harnessLabel(registration.harness);
          return (
            <div
              key={registration.harness}
              className="flex flex-col gap-1.5"
              data-testid={`management-registration-${registration.harness}`}
            >
              <p className="text-xs font-medium text-muted">
                {harness}
                {copy.app.common.separator}
                {text.register.file(registration.file)}
              </p>
              <CodeBlock
                content={registration.content}
                language={registration.language}
                wrap
                copyLabel={text.register.copy(harness)}
                showCopyLabel
                testId={`management-registration-${registration.harness}-content`}
                className="my-0"
              />
              {registration.shell !== null && (
                <>
                  <p className="text-xs leading-relaxed text-muted">
                    {text.register.codexShell}
                  </p>
                  <CodeBlock
                    content={registration.shell}
                    language="bash"
                    wrap
                    copyLabel={text.register.copyShell}
                    showCopyLabel
                    testId={`management-registration-${registration.harness}-shell`}
                    className="my-0"
                  />
                </>
              )}
            </div>
          );
        },
      )}
    </div>
  );
}

/**
 * Create a management key (the same key service and audit as the Keys page, §9.2) and
 * show it once with the registration for each harness (§10, ADR 0072 amendment).
 */
export function ManagementKeyCard() {
  const { organization } = useWorkspace();
  const refresh = useRefreshKeys(organization.id);
  const [name, setName] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () =>
      createPersonalKey({
        name: name.trim(),
        permissions: managementPermissions,
      }),
    onSuccess: async (result) => {
      setSecret(result.key);
      setName("");
      await refresh();
    },
  });
  return (
    <Card data-testid="management-key">
      <CardHeader>
        <div className="min-w-0 flex-1">
          <CardTitle>{text.create.title}</CardTitle>
          <CardDescription>{text.create.description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {secret !== null ? (
          <>
            <Alert variant="success">{text.create.created}</Alert>
            <KeySecretPanel
              secret={secret}
              showCommand={false}
              onDismiss={() => {
                setSecret(null);
                create.reset();
              }}
            >
              <Registrations secret={secret} />
            </KeySecretPanel>
          </>
        ) : (
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              if (name.trim()) create.mutate();
            }}
          >
            <Field label={text.create.name} className="sm:max-w-sm sm:flex-1">
              {(props) => (
                <Input
                  {...props}
                  required
                  maxLength={128}
                  placeholder={text.create.namePlaceholder}
                  value={name}
                  disabled={create.isPending}
                  onChange={(event) => {
                    setName(event.target.value);
                  }}
                />
              )}
            </Field>
            <Button
              type="submit"
              disabled={create.isPending || name.trim() === ""}
            >
              {create.isPending ? copy.app.common.pending : text.create.submit}
            </Button>
          </form>
        )}
        {create.error !== null && <RequestError error={create.error} />}
      </CardContent>
    </Card>
  );
}
