import { createContext, useContext, useEffect, useState } from "react";
import { Outlet, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, unwrap } from "../../lib/api/client";
import { authClient } from "../../lib/auth-client";
import { useAuthConfig } from "../../lib/use-auth-config";
import { closeStreams } from "../../lib/streams";
import { copy } from "../../copy";
import type { Me, Organization } from "../../lib/types";
import { WorkspaceFrame } from "./frame";
import { EmptyState, LoadingState, RequestError } from "./primitives";
import { NativeLogin } from "../../pages/auth";
const WorkspaceContext = createContext<{
  me: Me;
  organization: Organization;
} | null>(null);
export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("Workspace context is missing");
  return value;
}
export function ConnectedLogin() {
  const query = useAuthConfig();
  if (query.isPending)
    return (
      <main id="main" className="login-page container">
        <LoadingState />
      </main>
    );
  if (query.error)
    return (
      <main id="main" className="login-page container">
        <div className="login-card">
          <h1>{copy.workspace.auth.nativeTitle}</h1>
          <RequestError
            error={query.error}
            retry={() => {
              void query.refetch();
            }}
          />
        </div>
      </main>
    );
  return <NativeLogin config={query.data} />;
}
export function WorkspaceLayout() {
  const client = useQueryClient();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const [switching, setSwitching] = useState(false);
  const [operationError, setOperationError] = useState<unknown>(null);
  const me = useQuery({
    queryKey: ["identity"],
    queryFn: async ({ signal }) =>
      unwrap(await api.GET("/api/v1/me", { signal })),
    retry: false,
    enabled: !switching,
  });
  const organizations = useQuery({
    queryKey: ["organizations"],
    queryFn: async ({ signal }) =>
      unwrap(await api.GET("/api/v1/me/organizations", { signal })),
    enabled: !!me.data && !switching,
  });
  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401)
      window.location.assign("/login");
  }, [me.error]);
  const changeOrganization = async (id: string) => {
    setSwitching(true);
    setOperationError(null);
    closeStreams();
    await client.cancelQueries();
    client.clear();
    try {
      unwrap(
        await api.POST("/api/v1/me/organization", {
          body: { organization_id: id },
        }),
      );
    } catch (error) {
      setOperationError(error);
    } finally {
      setSwitching(false);
      await client.invalidateQueries();
    }
  };
  const signOut = async () => {
    setOperationError(null);
    closeStreams();
    await client.cancelQueries();
    const response = await authClient.signOut();
    if (response.error) {
      setOperationError(
        new Error(
          response.error.message ?? copy.workspace.common.requestFailed,
        ),
      );
      return;
    }
    client.clear();
    window.location.assign("/login");
  };
  if (me.isPending || switching)
    return (
      <main id="main" className="workspace-content">
        <LoadingState />
      </main>
    );
  if (me.error)
    return (
      <main id="main" className="workspace-content">
        <RequestError
          error={me.error}
          retry={() => {
            void me.refetch();
          }}
        />
      </main>
    );
  const admin =
    me.data.caller?.role === "owner" || me.data.caller?.role === "admin";
  return (
    <WorkspaceFrame
      admin={admin}
      me={me.data}
      organizations={organizations.data?.organizations ?? []}
      pathname={pathname}
      switching={switching}
      onSwitch={(id) => {
        void changeOrganization(id);
      }}
      onSignOut={() => {
        void signOut().catch(setOperationError);
      }}
    >
      {operationError !== null && <RequestError error={operationError} />}
      {organizations.error && (
        <RequestError
          error={organizations.error}
          retry={() => {
            void organizations.refetch();
          }}
        />
      )}
      {me.data.organization ? (
        <WorkspaceContext.Provider
          value={{ me: me.data, organization: me.data.organization }}
        >
          {pathname.startsWith("/admin/") && !admin ? (
            <div>
              <h1>{copy.workspace.navigation.adminRequired}</h1>
              <p className="panel-description">
                {copy.workspace.navigation.adminRequiredHint}
              </p>
              <a href="/sessions">{copy.workspace.navigation.sessions}</a>
            </div>
          ) : (
            <Outlet />
          )}
        </WorkspaceContext.Provider>
      ) : (
        <EmptyState
          title={
            organizations.data?.organizations.length
              ? copy.workspace.navigation.chooseOrganization
              : copy.workspace.navigation.noOrganization
          }
          description={
            organizations.data?.organizations.length
              ? copy.workspace.navigation.chooseOrganizationHint
              : copy.workspace.navigation.noOrganizationHint
          }
        />
      )}
    </WorkspaceFrame>
  );
}
