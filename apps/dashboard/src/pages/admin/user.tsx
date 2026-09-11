import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { personDashboard } from "@agentcommons/core/dashboards";
import { copy } from "../../copy";
import { api, ApiError, unwrap } from "../../lib/api/client";
import { dateTime, relativeTime, statusLabel } from "../../lib/display";
import type { Member } from "../../lib/types";
import { useWorkspace } from "../../components/app/workspace";
import {
  CopyButton,
  DefinitionList,
  LoadingState,
  RequestError,
} from "../../components/app/states";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { EmptyState, PageHeader } from "../../components/ui/feedback";
import { useDashboardData } from "../../features/dashboards/api";
import { DashboardGrid } from "../../features/dashboards/grid";
import { DashboardTileCard } from "../../features/dashboards/tiles";
import { useVariableState } from "../../features/dashboards/use-variables";
import { VariablesBar } from "../../features/dashboards/variables";
import { SessionSearch } from "../../features/sessions/session-search";

const text = copy.admin.person;
const people = copy.admin.users;
const fields = copy.app.fields;
/** The member's name when they have one that is not just their address. */
const displayName = (member: Pick<Member, "name" | "email">) =>
  member.name && member.name !== member.email ? member.name : member.email;
/** When the member last used the dashboard, or "Never" before their first visit. */
export function LastSeen({ value }: { value: string | null }) {
  if (value === null)
    return <span className="text-muted">{people.neverSeen}</span>;
  return (
    <time dateTime={value} title={dateTime(value)}>
      {relativeTime(value)}
    </time>
  );
}

/** One member: who they are, their activity across coding agents and their sessions. */
export function PersonPage({ id }: { id: string }) {
  const { organization } = useWorkspace();
  const member = useQuery({
    queryKey: [organization.id, "admin", "users", id],
    // A missing member is final; retrying only delays the not-found state.
    retry: (count, error) =>
      count < 1 && !(error instanceof ApiError && error.status === 404),
    queryFn: async ({ signal }): Promise<Member> =>
      unwrap(
        await api.GET("/api/v1/admin/users/{id}", {
          params: { path: { id } },
          signal,
        }),
      ),
  });
  if (member.isPending) return <LoadingState />;
  if (member.error) {
    if (member.error instanceof ApiError && member.error.status === 404)
      return (
        <EmptyState
          title={text.notFound}
          description={text.notFoundHint}
          action={
            <Button asChild variant="secondary">
              <Link to="/app/admin/users">{text.back}</Link>
            </Button>
          }
        />
      );
    return (
      <RequestError
        error={member.error}
        retry={() => {
          void member.refetch();
        }}
      />
    );
  }
  return <PersonView member={member.data} />;
}

function PersonView({ member }: { member: Member }) {
  const definition = personDashboard;
  const { values, setVariable } = useVariableState(definition.variables);
  // The member is the page, not a control: every tile reads `{person:String}` as their email.
  const variables = useMemo(
    () => ({ ...values, person: member.email }),
    [values, member.email],
  );
  const controls = useMemo(
    () => definition.variables.filter((variable) => variable.type !== "text"),
    [definition.variables],
  );
  const data = useDashboardData({
    scope: `person:${member.id}`,
    source: { definition },
    variables,
  });
  return (
    <div className="flex flex-col gap-6" data-testid="person-page">
      <PageHeader
        title={displayName(member)}
        description={text.description(member.email)}
        actions={
          <Button asChild variant="secondary">
            <Link to="/app/admin/users">
              <ArrowLeft aria-hidden />
              {text.back}
            </Link>
          </Button>
        }
      />
      <DefinitionList
        columns={4}
        className="rounded-lg border border-line bg-surface p-4"
        items={[
          { label: fields.email, value: member.email },
          { label: fields.role, value: statusLabel(member.role) },
          {
            label: people.filterStatus,
            value: (
              <Badge variant={member.suspended ? "warning" : "success"}>
                {member.suspended ? people.suspended : people.active}
              </Badge>
            ),
          },
          { label: people.addedAt, value: dateTime(member.created_at) },
          {
            label: people.lastSeen,
            value: <LastSeen value={member.last_seen_at} />,
          },
          {
            label: fields.user_id,
            value: (
              <span className="inline-flex items-center gap-1 font-mono text-xs">
                {member.user_id}
                <CopyButton value={member.user_id} />
              </span>
            ),
          },
        ]}
      />
      <section className="flex flex-col gap-4" data-testid="person-activity">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            {text.activity}
          </h2>
          <p className="text-sm text-muted">{text.activityHint}</p>
        </div>
        <VariablesBar
          variables={controls}
          values={values}
          onChange={setVariable}
        />
        {data.error !== null && (
          <RequestError
            error={data.error}
            retry={() => {
              void data.refreshAll();
            }}
          />
        )}
        <DashboardGrid
          tiles={definition.tiles}
          editing={false}
          renderTile={(tile) => (
            <DashboardTileCard
              tile={tile}
              result={data.results.get(tile.id)}
              loading={data.pending}
              refreshing={data.refreshing.has(tile.id)}
              editing={false}
              onRefresh={() => {
                void data.refreshTile(tile.id);
              }}
              variables={definition.variables}
              values={variables}
              onVariableChange={setVariable}
            />
          )}
        />
      </section>
      <section className="flex flex-col gap-4" data-testid="person-sessions">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            {text.sessions}
          </h2>
          <p className="text-sm text-muted">{text.sessionsHint}</p>
        </div>
        <SessionSearch
          target={{ to: "/app/admin/users/$id", params: { id: member.id } }}
          fixed={{ user_email: [member.email] }}
          exclude={["user_email"]}
          hideColumns={["user_email"]}
        />
      </section>
    </div>
  );
}
