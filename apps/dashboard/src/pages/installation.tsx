import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { formatInstallCommand } from "@agentcommons/core/format/install";
import { copy } from "../copy";
import { api, unwrap } from "../lib/api/client";
import { createPersonalKey } from "../lib/api/keys";
import { dateTime } from "../lib/display";
import { useWorkspace } from "../components/workspace/context";
import {
  CopyButton,
  Field,
  PageHeading,
  RequestError,
  LoadingState,
} from "../components/workspace/primitives";
import { Button } from "../components/ui/button";

export function InstallationPage() {
  const { organization, me } = useWorkspace();
  const labels = copy.workspace.installation;
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: () =>
      createPersonalKey({
        name: name.trim(),
        permissions: { sessions: ["ingest", "read"] },
      }),
  });
  const recent = useQuery({
    queryKey: [organization.id, "installation-recent", me.user.id],
    enabled: !!create.data,
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
    refetchInterval: create.data ? 5_000 : false,
  });
  const command = create.data
    ? formatInstallCommand(window.location.origin, create.data.key)
    : "";
  return (
    <>
      <PageHeading title={labels.title} description={labels.description} />
      <ol className="installation-steps">
        <li>
          <span className="installation-step-number" aria-hidden>
            {1}
          </span>
          <section aria-label={labels.keyTitle}>
            <h2>{labels.keyTitle}</h2>
            <p>{labels.keyDescription}</p>
            {create.data ? (
              <p className="form-success" role="status">
                {labels.keyCreated}
              </p>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  create.mutate();
                }}
              >
                <Field label={labels.machineName}>
                  {(props) => (
                    <input
                      {...props}
                      value={name}
                      required
                      maxLength={128}
                      placeholder={labels.nameExample}
                      onChange={(event) => {
                        setName(event.target.value);
                      }}
                      disabled={create.isPending}
                    />
                  )}
                </Field>
                <Button
                  type="submit"
                  disabled={create.isPending || !name.trim()}
                >
                  {create.isPending
                    ? copy.workspace.common.pending
                    : labels.createKey}
                </Button>
              </form>
            )}
            {create.error && <RequestError error={create.error} />}
          </section>
        </li>
        <li>
          <span className="installation-step-number" aria-hidden>
            {2}
          </span>
          <section aria-label={labels.commandTitle}>
            <h2>{labels.commandTitle}</h2>
            <p>{labels.commandDescription}</p>
            {create.data ? (
              <div className="install-command">
                <code>{command}</code>
                <CopyButton value={command} label={labels.copyCommand} />
              </div>
            ) : (
              <p className="field-hint">{labels.commandPending}</p>
            )}
            <p className="field-hint">{labels.codexTrust}</p>
          </section>
        </li>
        <li>
          <span className="installation-step-number" aria-hidden>
            {3}
          </span>
          <section aria-label={labels.captureTitle}>
            <h2>{labels.captureTitle}</h2>
            <p>{labels.captureDescription}</p>
            {recent.isFetching && !recent.data && create.data && (
              <LoadingState />
            )}
            {recent.error && (
              <RequestError
                error={recent.error}
                retry={() => {
                  void recent.refetch();
                }}
              />
            )}
            {recent.data && (
              <>
                <h3>{labels.recent}</h3>
                <ul className="installation-arrivals">
                  {recent.data.items.map((session) => (
                    <li key={session.session_id}>
                      <a href={`/s/${session.session_id}`}>
                        {session.title ?? copy.workspace.common.unavailable}
                      </a>
                      <span>{dateTime(session.last_activity_at)}</span>
                    </li>
                  ))}
                </ul>
                {recent.data.items.length === 0 && (
                  <p className="field-hint">{labels.waiting}</p>
                )}
              </>
            )}
            <a className="button button-secondary" href="/sessions">
              {labels.openSessions}
            </a>
          </section>
        </li>
      </ol>
      <p className="field-hint">
        {labels.manageHint} <a href="/keys">{copy.workspace.navigation.keys}</a>
      </p>
    </>
  );
}
