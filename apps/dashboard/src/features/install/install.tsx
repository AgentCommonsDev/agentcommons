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
      <p className="text-xs text-muted">{copy.install.run.shellHint}</p>
    </div>
  );
}
/** The small link under step 1 that swaps the create form for the picker and back. */
function ModeSwitch({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="self-start rounded text-sm font-medium text-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      {children}
    </button>
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
  // The key created on this page: its value fills the command, its id preselects the picker.
  const [created, setCreated] = useState<{ id: string; key: string } | null>(
    null,
  );
  // The one-time secret panel stays open from creation until "I saved the key".
  const [panelOpen, setPanelOpen] = useState(false);
  // The key the step-3 command carries: created here or picked from existing keys (ADR 0051).
  const [picked, setPicked] = useState<string | null>(null);
  // Step 1 shows one path at a time: the create form or the picker.
  const [mode, setMode] = useState<"create" | "existing">("create");
  const choosing = !panelOpen && mode === "existing";
  const create = useMutation({
    mutationFn: () =>
      createPersonalKey({
        name: machine.trim(),
        permissions: { sessions: ["ingest", "read"] },
      }),
    onSuccess: async (result) => {
      setCreated({ id: result.metadata.id, key: result.key });
      setPicked(result.key);
      setPanelOpen(true);
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
          title={
            choosing ? copy.install.key.chooseTitle : copy.install.key.title
          }
          description={
            choosing
              ? copy.install.key.chooseDescription
              : copy.install.key.description
          }
        >
          {panelOpen && created !== null ? (
            <>
              <Alert variant="success">{copy.install.key.created}</Alert>
              <KeySecretPanel
                secret={created.key}
                showCommand={false}
                onDismiss={() => {
                  // Only the one-time reveal closes; the key stays selected for step 3.
                  setPanelOpen(false);
                  setMode("existing");
                  setMachine("");
                  create.reset();
                }}
              />
            </>
          ) : choosing ? (
            <>
              <InstallKeyPicker onKey={setPicked} initialKeyId={created?.id} />
              {/* A key made on this page is the key for this machine; no second one until reload. */}
              {created === null && (
                <ModeSwitch
                  onClick={() => {
                    setPicked(null);
                    setMode("create");
                  }}
                >
                  {copy.install.key.createNew}
                </ModeSwitch>
              )}
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
          {!panelOpen && !choosing && (
            <ModeSwitch
              onClick={() => {
                create.reset();
                setMode("existing");
              }}
            >
              {copy.install.key.useExisting}
            </ModeSwitch>
          )}
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
          <InstallCommand apiKey={picked} />
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
