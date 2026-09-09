import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Outlet, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, unwrap } from "../../lib/api/client";
import { useBillingConfig } from "../../lib/billing-config";
import { authClient } from "../../lib/auth-client";
import { closeStreams } from "../../lib/streams";
import { copy } from "../../copy";
import type { Me, Organization } from "../../lib/types";
import { isAdminPath, paths } from "../../lib/routes";
import { AppShell } from "./shell";
import { LoadingState, RequestError } from "./states";
import { EmptyState } from "../ui/feedback";
import { Button } from "../ui/button";
import { TooltipProvider } from "../ui/menu";

const WorkspaceContext = createContext<{
  me: Me;
  organization: Organization;
  admin: boolean;
} | null>(null);
export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("Workspace context is missing");
  return value;
}
export function WorkspaceLayout() {
  const billing = useBillingConfig();
  const client = useQueryClient();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const [switching, setSwitching] = useState(false);
  const [operationError, setOperationError] = useState<unknown>(null);
  const autoSelected = useRef(false);
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
      window.location.assign(paths.login);
    if (
      billing.enabled &&
      me.data &&
      ["verify_email", "create_organization", "contact_admin"].includes(
        me.data.onboarding,
      )
    )
      window.location.assign(paths.onboarding);
  }, [me.error, me.data, billing.enabled]);
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
  // Members of exactly one (or a first) organization should never see a picker first.
  useEffect(() => {
    const list = organizations.data?.organizations;
    if (
      autoSelected.current ||
      switching ||
      !me.data ||
      me.data.organization ||
      !list?.length
    )
      return;
    const first = list[0];
    if (!first) return;
    autoSelected.current = true;
    void changeOrganization(first.id);
  }, [organizations.data, me.data, switching]);
  const signOut = async () => {
    setOperationError(null);
    closeStreams();
    await client.cancelQueries();
    const response = await authClient.signOut();
    if (response.error) {
      setOperationError(
        new Error(response.error.message ?? copy.app.common.requestFailed),
      );
      return;
    }
    client.clear();
    window.location.assign(paths.login);
  };
  if (me.isPending || switching)
    return (
      <main id="main" className="mx-auto w-full max-w-5xl px-6 py-10">
        <LoadingState />
      </main>
    );
  if (me.error)
    return (
      <main id="main" className="mx-auto w-full max-w-5xl px-6 py-10">
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
    <TooltipProvider delayDuration={300}>
      <AppShell
        me={me.data}
        organizations={organizations.data?.organizations ?? []}
        admin={admin}
        billing={billing.enabled}
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
            value={{ me: me.data, organization: me.data.organization, admin }}
          >
            {isAdminPath(pathname) && !admin ? (
              <EmptyState
                title={copy.app.navigation.adminRequired}
                description={copy.app.navigation.adminRequiredHint}
                action={
                  <Button asChild variant="secondary">
                    <a href={paths.home}>{copy.app.navigation.backHome}</a>
                  </Button>
                }
              />
            ) : (
              <Outlet />
            )}
          </WorkspaceContext.Provider>
        ) : organizations.isPending ||
          (organizations.data?.organizations.length ?? 0) > 0 ? (
          <LoadingState />
        ) : (
          <EmptyState
            title={copy.app.navigation.noOrganization}
            description={copy.app.navigation.noOrganizationHint}
          />
        )}
      </AppShell>
    </TooltipProvider>
  );
}
