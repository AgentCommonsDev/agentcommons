import { formatInstallCommand } from "@agentcommons/core/format/install";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, Copy, Radio } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  CopyButton,
  LoadingState,
  RequestError,
} from "../../components/app/states";
import { useWorkspace } from "../../components/app/workspace";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { Alert, EmptyState, Spinner } from "../../components/ui/feedback";
import { Field } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { copy } from "../../copy";
import { api, unwrap } from "../../lib/api/client";
import { createPersonalKey } from "../../lib/api/keys";
import { harnessLabel, relativeTime } from "../../lib/display";
import { paths } from "../../lib/routes";
import { cn } from "../../lib/utils";
import { KeySecretPanel } from "../keys/key-secret";
import { useRefreshKeys } from "../keys/queries";
import { InstallKeyPicker } from "../keys/reveal";

/**
 * The served installer command for this origin. `apiKey` is null until a key is created
 * on this page or picked from the caller's keys; until then the block is disabled and
 * nothing is offered to copy, so nobody runs a command with a missing key.
 */
function InstallCommand({ apiKey }: { apiKey: string | null }) {
  const command =
    apiKey === null
      ? null
      : formatInstallCommand(window.location.origin, apiKey);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div
          data-testid="install-command"
          aria-disabled={command === null ? true : undefined}
          className={cn(
            "m-0 min-w-0 flex-1 rounded-md border px-3 py-2.5 text-[13px] leading-relaxed",
            command === null
              ? "border-dashed border-line bg-surface text-muted select-none"
              : "overflow-x-auto border-line bg-raised font-mono whitespace-pre-wrap break-all",
          )}
        >
          {command === null ? (
            copy.install.command.pending
          ) : (
            <code>{command}</code>
          )}
        </div>
        {command === null ? (
          <Button variant="secondary" size="sm" disabled>
            <Copy aria-hidden />
            {copy.install.command.copy}
          </Button>
        ) : (
          <CopyButton
            value={command}
            label={copy.install.command.copy}
            showLabel
            variant="secondary"
          />
        )}
      </div>
      {command !== null && (
        <p className="text-xs text-muted">{copy.install.command.secretHint}</p>
      )}
    </div>
  );
}

function Step({
  index,
  title,
  description,
  children,
  footer,
}: {
  index: number;
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <li>
      <Card>
        <CardHeader className="flex-nowrap">
          <span
            aria-hidden
            className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-bg text-[13px] font-semibold text-accent"
          >
            {index}
          </span>
          <div className="min-w-0 flex-1">
            <CardTitle>
              <span className="sr-only">
                {copy.install.step} {index}
                {copy.app.common.separator}
              </span>
              {title}
            </CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">{children}</CardContent>
        {footer && <CardFooter>{footer}</CardFooter>}
      </Card>
    </li>
  );
}

/** Four steps: create or pick a key, read what the installer does, run the command it unlocks, watch the first session arrive. */
export function Install() {
  const { organization, me } = useWorkspace();
  const refresh = useRefreshKeys(organization.id);
  const [machine, setMachine] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  // An existing key picked below (ADR 0051); a key created on this page takes precedence.
  const [picked, setPicked] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () =>
      createPersonalKey({
        name: machine.trim(),
        permissions: { sessions: ["ingest", "read"] },
      }),
    onSuccess: async (result) => {
      setSecret(result.key);
      await refresh();
    },
  });
  const arrivals = useQuery({
    queryKey: [organization.id, "install-arrivals", me.user.email],
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET("/api/v1/sessions", {
          params: {
            query: {
              limit: 5,
              sort: "last_activity_at",
              order: "desc",
              filters: { user_email: me.user.email },
            },
          },
          signal,
        }),
      ),
    refetchInterval: 5_000,
  });
  return (
    <div className="flex flex-col gap-5">
      <ol className="flex flex-col gap-4">
        <Step
          index={1}
          title={copy.install.key.title}
          description={copy.install.key.description}
        >
          {secret !== null ? (
            <>
              <Alert variant="success">{copy.install.key.created}</Alert>
              <KeySecretPanel
                secret={secret}
                showCommand={false}
                onDismiss={() => {
                  setSecret(null);
                  setMachine("");
                  create.reset();
                }}
              />
            </>
          ) : (
            <form
              className="flex flex-col gap-3 sm:flex-row sm:items-end"
              onSubmit={(event) => {
                event.preventDefault();
                if (machine.trim()) create.mutate();
              }}
            >
              <Field
                label={copy.install.key.machine}
                className="sm:max-w-sm sm:flex-1"
              >
                {(props) => (
                  <Input
                    {...props}
                    required
                    maxLength={128}
                    placeholder={copy.install.key.machinePlaceholder}
                    value={machine}
                    disabled={create.isPending}
                    onChange={(event) => {
                      setMachine(event.target.value);
                    }}
                  />
                )}
              </Field>
              <Button
                type="submit"
                disabled={create.isPending || machine.trim() === ""}
              >
                {create.isPending
                  ? copy.app.common.pending
                  : copy.install.key.submit}
              </Button>
            </form>
          )}
          {create.error !== null && <RequestError error={create.error} />}
          {secret === null && <InstallKeyPicker onKey={setPicked} />}
        </Step>
        <Step
          index={2}
          title={copy.install.prepare.title}
          description={copy.install.prepare.description}
        >
          <div>
            <p className="mb-2 text-xs font-medium text-muted">
              {copy.install.prepare.notesTitle}
            </p>
            <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
              {Object.entries(copy.install.prepare.notes).map(
                ([harness, note]) => (
                  <div key={harness} className="contents">
                    <dt className="font-medium">{harnessLabel(harness)}</dt>
                    <dd className="text-muted">{note}</dd>
                  </div>
                ),
              )}
            </dl>
          </div>
        </Step>
        <Step
          index={3}
          title={copy.install.run.title}
          description={copy.install.run.description}
        >
          <InstallCommand apiKey={secret ?? picked} />
        </Step>
        <Step
          index={4}
          title={copy.install.arrivals.title}
          description={copy.install.arrivals.description}
          footer={
            <Button asChild variant="ghost" size="sm">
              <a href={paths.sessions}>
                {copy.install.arrivals.allSessions}
                <ArrowRight aria-hidden />
              </a>
            </Button>
          }
        >
          <div data-testid="install-arrivals" className="flex flex-col gap-3">
            <p
              className="flex items-center gap-2 text-xs text-muted"
              role="status"
            >
              {arrivals.isFetching ? (
                <Spinner size={13} />
              ) : (
                <Radio size={13} aria-hidden />
              )}
              {copy.install.arrivals.polling}
            </p>
            {arrivals.isPending ? (
              <LoadingState rows={2} />
            ) : arrivals.error !== null ? (
              <RequestError
                error={arrivals.error}
                retry={() => {
                  void arrivals.refetch();
                }}
              />
            ) : arrivals.data.items.length === 0 ? (
              <EmptyState
                compact
                title={copy.install.arrivals.empty}
                description={copy.install.arrivals.emptyHint}
              />
            ) : (
              <ul className="divide-y divide-line-soft rounded-lg border border-line">
                {arrivals.data.items.map((session) => (
                  <li key={session.session_id}>
                    <a
                      href={paths.session(session.session_id)}
                      className="flex flex-col gap-1 px-4 py-3 transition-colors hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent sm:flex-row sm:items-center sm:gap-3"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {session.title ?? copy.install.arrivals.untitled}
                      </span>
                      <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
                        <Badge>{harnessLabel(session.harness)}</Badge>
                        {session.repo_name !== null && (
                          <span className="truncate font-mono">
                            {session.repo_name}
                          </span>
                        )}
                        <span>{relativeTime(session.last_activity_at)}</span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Step>
      </ol>
    </div>
  );
}
