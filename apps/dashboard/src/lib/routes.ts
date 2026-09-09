/** Every in-app path in one place so links, redirects and tests agree. */
export const paths = {
  home: "/app",
  dashboard: (id: string) => `/app/dashboards/${id}`,
  dashboardNew: "/app/dashboards/new",
  dashboardEdit: (id: string) => `/app/dashboards/${id}/edit`,
  sessions: "/app/sessions",
  /** `child` opens a run nested inside its root session's page; `seq` is a message there. */
  session: (id: string, seq?: number, child?: string) =>
    `/app/sessions/${id}${child === undefined ? "" : `?child=${encodeURIComponent(child)}`}${seq === undefined ? "" : `#${String(seq)}`}`,
  sql: "/app/sql",
  install: "/app/install",
  keys: "/app/keys",
  api: "/app/api",
  billing: "/app/billing",
  organizationsNew: "/app/organizations/new",
  admin: {
    users: "/app/admin/users",
    keys: "/app/admin/keys",
    audit: "/app/admin/audit",
    moderation: "/app/admin/moderation",
    redaction: "/app/admin/redaction",
    status: "/app/admin/status",
    settings: "/app/admin/settings",
  },
  login: "/login",
  signup: "/signup",
  onboarding: "/onboarding",
  forgotPassword: "/forgot-password",
  verifyEmail: "/verify-email",
  setupPassword: "/setup-password",
  apiReference: "/api/docs/",
  site: "/",
  privacy: "/privacy",
  tos: "/tos",
} as const;
export const isAdminPath = (pathname: string) =>
  pathname.startsWith("/app/admin");
