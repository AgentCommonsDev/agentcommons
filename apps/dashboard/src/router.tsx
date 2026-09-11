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
const PasswordSetupPage = lazyRouteComponent(
  () => import("./pages/auth/password-setup"),
  "PasswordSetupPage",
);
const LoginPage = lazyRouteComponent(
  () => import("./pages/auth/login"),
  "LoginPage",
);
const SignupPage = lazyRouteComponent(
  () => import("./pages/auth/signup"),
  "SignupPage",
);
const ForgotPasswordPage = lazyRouteComponent(
  () => import("./pages/auth/signup"),
  "ForgotPasswordPage",
);
const VerifyEmailPage = lazyRouteComponent(
  () => import("./pages/auth/signup"),
  "VerifyEmailPage",
);
const OnboardingPage = lazyRouteComponent(
  () => import("./pages/auth/onboarding"),
  "OnboardingPage",
);
const DashboardPage = lazyRouteComponent(
  () => import("./pages/home"),
  "DashboardPage",
);
const DashboardNewPage = lazyRouteComponent(
  () => import("./pages/home"),
  "DashboardNewPage",
);
const DashboardEditPage = lazyRouteComponent(
  () => import("./pages/home"),
  "DashboardEditPage",
);
const SessionPage = lazyRouteComponent(
  () => import("./pages/session"),
  "SessionPage",
);
const RedactionPage = lazyRouteComponent(
  () => import("./pages/admin/redaction"),
  "RedactionPage",
);
/**
 * Optional string search parameters; anything but a string reads as absent. The keys are
 * optional, so a search reducer can spread the previous search and set only its own.
 */
function optionalStrings<Key extends string>(...keys: Key[]) {
  return (
    search: Record<string, unknown>,
  ): { [Name in Key]?: string | undefined } =>
    Object.fromEntries(
      keys.map((key) => {
        const value = search[key];
        return [key, typeof value === "string" ? value : undefined];
      }),
    ) as { [Name in Key]?: string | undefined };
}
/** The message sequence a URL hash names, or null for anything else. */
function hashSequence(hash: string): number | null {
  const text = hash.replace(/^#/, "");
  return /^\d+$/.test(text) && Number.isSafeInteger(Number(text))
    ? Number(text)
    : null;
}

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
  path: paths.site,
  component: LandingPage,
});
const docsRoute = createRoute({
  getParentRoute: () => publicRoute,
  path: paths.docs,
  component: DocsPage,
});
const blogRoute = createRoute({
  getParentRoute: () => publicRoute,
  path: paths.blog,
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
  component: lazyRouteComponent(
    () => import("./pages/auth/layout"),
    "AccountLayout",
  ),
});
// Every account page reads `next`, the application page a signed-out visitor asked for,
// and hands it on until the account is ready (`returnPath` in lib/routes.ts validates it).
const loginRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: paths.login,
  validateSearch: optionalStrings("next"),
  component: () => {
    return <LoginPage next={loginRoute.useSearch().next} />;
  },
});
const setupRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: paths.setupPassword,
  validateSearch: optionalStrings("token", "next"),
  component: () => {
    const { token, next } = setupRoute.useSearch();
    return <PasswordSetupPage token={token} next={next} />;
  },
});
const signupRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: paths.signup,
  validateSearch: optionalStrings("next"),
  component: () => {
    return <SignupPage next={signupRoute.useSearch().next} />;
  },
});
const forgotRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: paths.forgotPassword,
  validateSearch: optionalStrings("next"),
  component: () => {
    return <ForgotPasswordPage next={forgotRoute.useSearch().next} />;
  },
});
const verifyEmailRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: paths.verifyEmail,
  validateSearch: optionalStrings("next"),
  component: () => {
    return <VerifyEmailPage next={verifyEmailRoute.useSearch().next} />;
  },
});
const onboardingRoute = createRoute({
  getParentRoute: () => accountRoute,
  path: paths.onboarding,
  validateSearch: optionalStrings("next"),
  component: () => {
    return <OnboardingPage next={onboardingRoute.useSearch().next} />;
  },
});

/* ---------- Authenticated app under /app ---------- */
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: paths.home,
  component: WorkspaceLayout,
});
const homeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  component: lazyRouteComponent(() => import("./pages/home"), "HomePage"),
});
const dashboardNewRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/dashboards/new",
  // `from` starts the editor with a copy of that dashboard.
  validateSearch: optionalStrings("from"),
  component: () => {
    return <DashboardNewPage from={dashboardNewRoute.useSearch().from} />;
  },
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
  component: lazyRouteComponent(
    () => import("./pages/sessions"),
    "SessionsPage",
  ),
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
        seq={hashSequence(hash)}
        {...(child === undefined ? {} : { child })}
      />
    );
  },
});
const sqlRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/sql",
  component: lazyRouteComponent(() => import("./pages/sql"), "SqlPage"),
});
const installRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/install",
  component: lazyRouteComponent(() => import("./pages/install"), "InstallPage"),
});
const keysRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/keys",
  component: lazyRouteComponent(() => import("./pages/keys"), "KeysPage"),
});
const apiReferenceRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/api",
  component: lazyRouteComponent(
    () => import("./pages/api"),
    "ApiReferencePage",
  ),
});
const billingRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/billing",
  component: lazyRouteComponent(() => import("./pages/billing"), "BillingPage"),
});
const newOrganizationRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/organizations/new",
  component: lazyRouteComponent(
    () => import("./pages/auth/onboarding"),
    "NewOrganizationPage",
  ),
});
const adminUsersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/admin/users",
  component: lazyRouteComponent(
    () => import("./pages/admin/users"),
    "UsersPage",
  ),
});
const adminKeysRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/admin/keys",
  component: lazyRouteComponent(
    () => import("./pages/admin/keys"),
    "AdminKeysPage",
  ),
});
const adminAuditRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/admin/audit",
  component: lazyRouteComponent(
    () => import("./pages/admin/audit"),
    "AuditPage",
  ),
});
const adminModerationRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/admin/moderation",
  component: lazyRouteComponent(
    () => import("./pages/admin/moderation"),
    "ModerationPage",
  ),
});
const adminRedactionRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/admin/redaction",
  // `job` is the rescan the page watches; the rest are the recent-redactions filters, so a
  // filtered ledger is a shareable link.
  validateSearch: optionalStrings(
    "job",
    "policy_id",
    "source",
    "session_id",
    "run_id",
    "q",
  ),
  component: () => {
    const { job, ...hitSearch } = adminRedactionRoute.useSearch();
    return <RedactionPage jobId={job} hitSearch={hitSearch} />;
  },
});
const adminStatusRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/admin/status",
  component: lazyRouteComponent(
    () => import("./pages/admin/status"),
    "StatusPage",
  ),
});
const adminSettingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/admin/settings",
  component: lazyRouteComponent(
    () => import("./pages/admin/settings"),
    "SettingsPage",
  ),
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
