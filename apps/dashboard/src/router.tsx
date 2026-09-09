import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";
import type { RouterHistory } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppShell as SiteShell } from "./components/shell";
import { BlogPage } from "./pages/blog";
import { DocsPage } from "./pages/docs";
import { LandingPage } from "./pages/landing";
import { LegalPage } from "./pages/legal";
import { NotFoundPage } from "./pages/not-found";
import { copy } from "./copy";
import { paths } from "./lib/routes";

const WorkspaceLayout = lazyRouteComponent(
  () => import("./components/app/workspace"),
  "WorkspaceLayout",
);
const page = <T extends Record<string, unknown>, K extends keyof T & string>(
  load: () => Promise<T>,
  name: K,
) => lazyRouteComponent<T, K>(load, name);

const PasswordSetupPage = page(
  () => import("./pages/auth/password-setup"),
  "PasswordSetupPage",
);
const DashboardPage = page(() => import("./pages/home"), "DashboardPage");
const DashboardEditPage = page(
  () => import("./pages/home"),
  "DashboardEditPage",
);
const SessionPage = page(() => import("./pages/session"), "SessionPage");
const RedactionPage = page(
  () => import("./pages/admin/redaction"),
  "RedactionPage",
);

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});
const rootRoute = createRootRoute({
  component: () => (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  ),
  notFoundComponent: () => (
    <SiteShell>
      <NotFoundPage />
    </SiteShell>
  ),
});

/* ---------- Public site and account pages ---------- */
const publicRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "public",
  component: () => (
    <SiteShell>
      <Outlet />
    </SiteShell>
  ),
});
const indexRoute = createRoute({
  getParentRoute: () => publicRoute,
  path: "/",
  component: LandingPage,
});
const docsRoute = createRoute({
  getParentRoute: () => publicRoute,
  path: "/docs",
  component: DocsPage,
});
const blogRoute = createRoute({
  getParentRoute: () => publicRoute,
  path: "/blog",
  component: BlogPage,
});
const blogPostRoute = createRoute({
  getParentRoute: () => publicRoute,
  path: "/blog/$slug",
  component: () => <BlogPage slug={blogPostRoute.useParams().slug} />,
});
const privacyRoute = createRoute({
  getParentRoute: () => publicRoute,
  path: paths.privacy,
  component: () => (
    <LegalPage
      document={copy.legal.privacy}
      related={{ title: copy.legal.terms.title, href: paths.tos }}
    />
  ),
});
const tosRoute = createRoute({
  getParentRoute: () => publicRoute,
  path: paths.tos,
  component: () => (
    <LegalPage
      document={copy.legal.terms}
      related={{ title: copy.legal.privacy.title, href: paths.privacy }}
    />
  ),
});
const accountRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "account",
  component: page(() => import("./pages/auth/layout"), "AccountLayout"),
});
const loginRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: "/login",
  component: page(() => import("./pages/auth/login"), "LoginPage"),
});
const setupRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: "/setup-password",
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : undefined,
  }),
  component: () => {
    return <PasswordSetupPage token={setupRoute.useSearch().token} />;
  },
});
const signupRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: "/signup",
  component: page(() => import("./pages/auth/signup"), "SignupPage"),
});
const forgotRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: "/forgot-password",
  component: page(() => import("./pages/auth/signup"), "ForgotPasswordPage"),
});
const verifyEmailRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: "/verify-email",
  component: page(() => import("./pages/auth/signup"), "VerifyEmailPage"),
});
const onboardingRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: "/onboarding",
  component: page(() => import("./pages/auth/onboarding"), "OnboardingPage"),
});

/* ---------- Authenticated app under /app ---------- */
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/app",
  component: WorkspaceLayout,
});
const homeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  component: page(() => import("./pages/home"), "HomePage"),
});
const dashboardNewRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/dashboards/new",
  component: page(() => import("./pages/home"), "DashboardNewPage"),
});
const dashboardRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/dashboards/$id",
  component: () => {
    return <DashboardPage id={dashboardRoute.useParams().id} />;
  },
});
const dashboardEditRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/dashboards/$id/edit",
  component: () => {
    return <DashboardEditPage id={dashboardEditRoute.useParams().id} />;
  },
});
const sessionsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/sessions",
  component: page(() => import("./pages/sessions"), "SessionsPage"),
});
const sessionRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/sessions/$id",
  // `child` names a run nested inside this root session; the hash is a message there.
  // The key is optional so plain session links need no search object.
  validateSearch: (search: Record<string, unknown>): { child?: string } =>
    typeof search.child === "string" && search.child.length > 0
      ? { child: search.child }
      : {},
  component: () => {
    const { id } = sessionRoute.useParams();
    const { child } = sessionRoute.useSearch();
    const hash = useRouterState({ select: (state) => state.location.hash });
    return (
      <SessionPage
        key={`${id}-${child ?? ""}-${hash}`}
        id={id}
        {...(child === undefined ? {} : { child })}
      />
    );
  },
});
const sqlRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/sql",
  component: page(() => import("./pages/sql"), "SqlPage"),
});
const installRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/install",
  component: page(() => import("./pages/install"), "InstallPage"),
});
const keysRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/keys",
  component: page(() => import("./pages/keys"), "KeysPage"),
});
const apiReferenceRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/api",
  component: page(() => import("./pages/api"), "ApiReferencePage"),
});
const billingRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/billing",
  component: page(() => import("./pages/billing"), "BillingPage"),
});
const newOrganizationRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/organizations/new",
  component: page(
    () => import("./pages/auth/onboarding"),
    "NewOrganizationPage",
  ),
});
const adminUsersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/admin/users",
  component: page(() => import("./pages/admin/users"), "UsersPage"),
});
const adminKeysRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/admin/keys",
  component: page(() => import("./pages/admin/keys"), "AdminKeysPage"),
});
const adminAuditRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/admin/audit",
  component: page(() => import("./pages/admin/audit"), "AuditPage"),
});
const adminModerationRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/admin/moderation",
  component: page(() => import("./pages/admin/moderation"), "ModerationPage"),
});
const adminRedactionRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/admin/redaction",
  validateSearch: (search: Record<string, unknown>) => ({
    job: typeof search.job === "string" ? search.job : undefined,
  }),
  component: () => {
    return <RedactionPage jobId={adminRedactionRoute.useSearch().job} />;
  },
});
const adminStatusRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/admin/status",
  component: page(() => import("./pages/admin/status"), "StatusPage"),
});
const adminSettingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/admin/settings",
  component: page(() => import("./pages/admin/settings"), "SettingsPage"),
});

const routeTree = rootRoute.addChildren([
  publicRoute.addChildren([
    indexRoute,
    docsRoute,
    blogRoute,
    blogPostRoute,
    privacyRoute,
    tosRoute,
  ]),
  accountRoute.addChildren([
    loginRoute,
    setupRoute,
    signupRoute,
    forgotRoute,
    verifyEmailRoute,
    onboardingRoute,
  ]),
  appRoute.addChildren([
    homeRoute,
    dashboardNewRoute,
    dashboardRoute,
    dashboardEditRoute,
    sessionsRoute,
    sessionRoute,
    sqlRoute,
    installRoute,
    keysRoute,
    apiReferenceRoute,
    billingRoute,
    newOrganizationRoute,
    adminUsersRoute,
    adminKeysRoute,
    adminAuditRoute,
    adminModerationRoute,
    adminRedactionRoute,
    adminStatusRoute,
    adminSettingsRoute,
  ]),
]);
export function makeRouter(history?: RouterHistory) {
  return createRouter({
    routeTree,
    ...(history ? { history } : {}),
    scrollRestoration: true,
  });
}
declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof makeRouter>;
  }
}
