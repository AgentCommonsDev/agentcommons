import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { copy } from "../../copy";
import { api, unwrap } from "../../lib/api/client";
import { number } from "../../lib/display";
import { useWorkspace } from "./context";
import { ConfirmAction } from "./confirm-action";
import { LoadingState, RequestError } from "./primitives";
import { Button } from "../ui/button";

export function OrganizationEmbeddings() {
  const { organization, me } = useWorkspace();
  const client = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const text = copy.workspace.organizationEmbeddings;
  const key = [organization.id, "organization-embeddings"];
  const query = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET("/api/v1/organization/embeddings", { signal })),
    refetchInterval: 10_000,
  });
  const data = query.data;
  const providerDescription = data?.provider
    ? `${text.provider}: ${data.provider} · ${data.model ?? ""}`
    : null;
  const admin = me.caller?.role === "owner" || me.caller?.role === "admin";
  return (
    <section
      className="metric-section"
      aria-labelledby="organization-embeddings-title"
    >
      <h2 id="organization-embeddings-title">{text.title}</h2>
      {query.isPending && <LoadingState />}
      {query.error && (
        <RequestError
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
        />
      )}
      {data && (
        <>
          <p>{data.effective ? text.enabled : text.disabled}</p>
          <p className="field-hint">
            {!data.available
              ? text.unavailable
              : data.enabled
                ? text.enabledHint
                : text.disabledHint}
          </p>
          {data.provider && <p>{providerDescription}</p>}
          {data.provider === "fake" && (
            <p className="field-hint">{text.fake}</p>
          )}
          {data.available && data.last_attempt === null && (
            <p className="field-hint">{text.unchecked}</p>
          )}
          {data.last_attempt === "failed" && <p role="status">{text.failed}</p>}
          <dl className="status-metrics">
            {[
              [text.total, data.sessions_total],
              [text.indexed, data.sessions_indexed],
              [text.pending, data.sessions_pending],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{typeof value === "number" ? number(value) : value}</dd>
              </div>
            ))}
          </dl>
          {admin && (
            <Button
              variant="secondary"
              disabled={!data.available && !data.enabled}
              onClick={() => {
                setConfirm(true);
              }}
            >
              {data.enabled ? text.disable : text.enable}
            </Button>
          )}
          <ConfirmAction
            open={confirm}
            onOpenChange={setConfirm}
            title={data.enabled ? text.disable : text.enable}
            description={
              data.enabled ? text.disableDescription : text.enableDescription
            }
            confirmLabel={data.enabled ? text.disable : text.enable}
            action={async (reason) => {
              const value = unwrap(
                await api.PATCH("/api/v1/organization/embeddings", {
                  body: { enabled: !data.enabled, reason },
                }),
              );
              client.setQueryData(key, value);
              await Promise.all([
                client.invalidateQueries({ queryKey: [organization.id] }),
                client.invalidateQueries({ queryKey: ["auth-config"] }),
              ]);
            }}
          />
        </>
      )}
    </section>
  );
}
