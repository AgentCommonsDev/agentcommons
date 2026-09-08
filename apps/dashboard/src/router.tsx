import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  lazyRouteComponent,
  useRouterState,
} from "@tanstack/react-router";
import type { RouterHistory } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppShell } from "./components/shell";
const ConnectedLogin = lazyRouteComponent(
  () => import("./components/workspace/context"),
  "ConnectedLogin",
);
const WorkspaceLayout = lazyRouteComponent(
  () => import("./components/workspace/context"),
  "WorkspaceLayout",
);
import { BlogPage } from "./pages/blog";
import { DocsPage } from "./pages/docs";
import { LandingPage } from "./pages/landing";
import { NotFoundPage } from "./pages/login";
const PasswordSetup = lazyRouteComponent(
  () => import("./pages/auth"),
  "PasswordSetup",
);
const SessionsPage = lazyRouteComponent(
  () => import("./pages/sessions"),
  "SessionsPage",
);
const HomePage = lazyRouteComponent(() => import("./pages/home"), "HomePage");
const SessionPage = lazyRouteComponent(
  () => import("./pages/session"),
  "SessionPage",
);
const SqlPage = lazyRouteComponent(() => import("./pages/sql"), "SqlPage");
const InstallationPage = lazyRouteComponent(
  () => import("./pages/installation"),
  "InstallationPage",
);
const KeysPage = lazyRouteComponent(() => import("./pages/keys"), "KeysPage");
const UsersPage = lazyRouteComponent(
  () => import("./pages/users"),
  "UsersPage",
);
const AuditPage = lazyRouteComponent(
  () => import("./pages/audit"),
  "AuditPage",
);
const ModerationPage = lazyRouteComponent(
  () => import("./pages/moderation"),
  "ModerationPage",
);
const RedactionPage = lazyRouteComponent(
  () => import("./pages/redaction"),
  "RedactionPage",
);
const StatusPage = lazyRouteComponent(
  () => import("./pages/status"),
  "StatusPage",
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
    <AppShell>
      <NotFoundPage />
    </AppShell>
  ),
});
const publicRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "public",
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
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
const loginRoute = createRoute({
  getParentRoute: () => publicRoute,
  path: "/login",
  component: ConnectedLogin,
});
const setupRoute = createRoute({
  getParentRoute: () => publicRoute,
  path: "/setup-password",
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : undefined,
  }),
  component: () => <PasswordSetup token={setupRoute.useSearch().token} />,
});
const signupRoute = createRoute({
  getParentRoute: () => publicRoute,
  path: "/signup",
  component: lazyRouteComponent(() => import("./pages/signup"), "SignupPage"),
});
const forgotRoute = createRoute({
  getParentRoute: () => publicRoute,
  path: "/forgot-password",
  component: lazyRouteComponent(
    () => import("./pages/signup"),
    "ForgotPasswordPage",
  ),
});
const verifyEmailRoute = createRoute({
  getParentRoute: () => publicRoute,
  path: "/verify-email",
  component: lazyRouteComponent(
    () => import("./pages/signup"),
    "VerifyEmailPage",
  ),
});
const onboardingRoute = createRoute({
  getParentRoute: () => publicRoute,
  path: "/onboarding",
  component: lazyRouteComponent(
    () => import("./pages/onboarding"),
    "OnboardingPage",
  ),
});
const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "workspace",
  component: WorkspaceLayout,
});
const newOrganizationRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "/organizations/new",
  component: lazyRouteComponent(
    () => import("./pages/organization-new"),
    "NewOrganizationPage",
  ),
});
const sessionsRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "/sessions",
  component: SessionsPage,
});
const homeRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "/home",
  component: HomePage,
});
const sessionRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "/s/$id",
  component: () => {
    const { id } = sessionRoute.useParams();
    const hash = useRouterState({ select: (state) => state.location.hash });
    return <SessionPage key={`${id}-${hash}`} id={id} />;
  },
});
const sqlRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "/sql",
  component: SqlPage,
});
const installationRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "/installation",
  component: InstallationPage,
});
const keysRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "/keys",
  component: () => <KeysPage />,
});
const usersRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "/admin/users",
  component: UsersPage,
});
const adminKeysRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "/admin/keys",
  component: () => <KeysPage admin />,
});
const auditRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "/admin/audit",
  component: AuditPage,
});
const moderationRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "/admin/moderation",
  component: ModerationPage,
});
const redactionRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "/admin/redaction",
  validateSearch: (search: Record<string, unknown>) => ({
    job: typeof search.job === "string" ? search.job : undefined,
  }),
  component: () => <RedactionPage jobId={redactionRoute.useSearch().job} />,
});
const statusRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "/admin/status",
  component: StatusPage,
});
const usageRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "/usage",
  component: lazyRouteComponent(() => import("./pages/usage"), "UsagePage"),
});
const routeTree = rootRoute.addChildren([
  publicRoute.addChildren([
    blogRoute,
    blogPostRoute,
    indexRoute,
    docsRoute,
    loginRoute,
    setupRoute,
    signupRoute,
    verifyEmailRoute,
    forgotRoute,
    onboardingRoute,
  ]),
  workspaceRoute.addChildren([
    newOrganizationRoute,
    homeRoute,
    usageRoute,
    sessionsRoute,
    sessionRoute,
    sqlRoute,
    keysRoute,
    installationRoute,
    usersRoute,
    adminKeysRoute,
    auditRoute,
    moderationRoute,
    redactionRoute,
    statusRoute,
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
