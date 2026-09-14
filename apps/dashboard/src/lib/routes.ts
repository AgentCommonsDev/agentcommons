/** Every in-app path in one place so links, redirects and tests agree. */
export const paths = {
  home: "/app",
  dashboard: (id: string) => `/app/dashboards/${id}`,
  dashboardNew: "/app/dashboards/new",
  /** The new-dashboard page started from a copy of `id`. */
  dashboardDuplicate: (id: string) =>
    `/app/dashboards/new?from=${encodeURIComponent(id)}`,
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
    /** One member: their details, activity and sessions. `id` is the membership id. */
    user: (id: string) => `/app/admin/users/${id}`,
    keys: "/app/admin/keys",
    /** The management MCP server: create a management key and register `agentcommons-admin`. */
    mcp: "/app/admin/mcp",
    audit: "/app/admin/audit",
    moderation: "/app/admin/moderation",
    redaction: "/app/admin/redaction",
    toolPolicy: "/app/admin/tool-policy",
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
  docs: "/docs",
  blog: "/blog",
  blogPost: (slug: string) => `/blog/${slug}`,
  privacy: "/privacy",
  tos: "/tos",
} as const;
export const isAdminPath = (pathname: string) =>
  pathname.startsWith("/app/admin");

/**
 * The application page a sign-in or signup returns to, read from the `next` search
 * parameter, or null for anything that is not a same-origin path under `/app`: one
 * leading slash, then `/app` at a path boundary, no scheme, host, backslash or
 * whitespace. Every consumer of `next` goes through here and falls back to its default.
 */
export function returnPath(value: unknown): string | null {
  return typeof value === "string" &&
    /^\/app(?:$|[/?#])/.test(value) &&
    !/[\\\s\p{Cc}]/u.test(value)
    ? value
    : null;
}
/**
 * `path` carrying `next` as its return address, or `path` alone when `next` is not a
 * return path. Home is where every flow ends anyway, so it needs no return address.
 */
export function withReturn(path: string, next: unknown): string {
  const target = returnPath(next);
  return target === null || target === paths.home
    ? path
    : `${path}?next=${encodeURIComponent(target)}`;
}
/** The page open in the browser as a return address: pathname, query and hash. */
export function currentPage(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}
