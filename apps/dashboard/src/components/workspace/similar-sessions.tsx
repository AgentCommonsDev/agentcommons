import { useQuery } from "@tanstack/react-query";
import { copy } from "../../copy";
import { api, unwrap } from "../../lib/api/client";
import { useAuthConfig } from "../../lib/use-auth-config";
import { dateTime, harnessLabel } from "../../lib/display";
import { useWorkspace } from "./context";
import {
  EmptyState,
  LoadingState,
  RequestError,
  StatusBadge,
} from "./primitives";

export function SimilarSessions({ sessionId }: { sessionId: string }) {
  const { organization } = useWorkspace();
  const config = useAuthConfig();
  const enabled = config.data?.features.includes("similar_sessions") ?? false;
  const query = useQuery({
    queryKey: [organization.id, "similar", sessionId],
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET("/api/v1/sessions/{id}/similar", {
          params: { path: { id: sessionId }, query: { max_rows: 5 } },
          signal,
        }),
      ),
    enabled,
  });
  if (config.error)
    return (
      <RequestError
        error={config.error}
        retry={() => {
          void config.refetch();
        }}
      />
    );
  if (!enabled) return null;
  return (
    <section className="similar-sessions" aria-labelledby="similar-heading">
      <h2 id="similar-heading">{copy.workspace.detail.similar}</h2>
      {query.isPending && <LoadingState />}
      {query.error && (
        <RequestError
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
        />
      )}
      {query.data?.sessions.length === 0 && (
        <EmptyState title={copy.workspace.detail.noSimilar} />
      )}
      {query.data && query.data.sessions.length > 0 && (
        <ul>
          {query.data.sessions.map((session) => (
            <li key={session.session_id}>
              <a href={`/s/${session.session_id}`}>
                {session.title ?? copy.workspace.sessions.untitled}
              </a>
              <div>
                <span>{harnessLabel(session.harness)}</span>
                <StatusBadge value={session.status} />
                <span>{session.repo_name}</span>
                <time dateTime={session.started_at}>
                  {dateTime(session.started_at)}
                </time>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
