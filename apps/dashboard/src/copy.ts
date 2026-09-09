import { publicCopy } from "./copy/public";
import { appCopy } from "./copy/app";
import { authCopy } from "./copy/auth";
import { dashboardsCopy } from "./copy/dashboards";
import { sessionsCopy } from "./copy/sessions";
import { installCopy } from "./copy/install";
import { keysCopy } from "./copy/keys";
import { apiReferenceCopy } from "./copy/api-reference";
import { sqlCopy } from "./copy/sql";
import { adminCopy } from "./copy/admin";
import { settingsCopy } from "./copy/settings";
import { legalCopy } from "./copy/legal";
export { links } from "./copy/public";
export type { LegalDocument } from "./copy/legal";

/**
 * Every string a person reads in the dashboard. Marketing and account strings live in
 * `copy/public.ts`; the authenticated app is split per area under `copy/`.
 */
export const copy = {
  ...publicCopy,
  app: appCopy,
  auth: authCopy,
  dashboards: dashboardsCopy,
  sessions: sessionsCopy,
  install: installCopy,
  keys: keysCopy,
  apiReference: apiReferenceCopy,
  sql: sqlCopy,
  admin: adminCopy,
  settings: settingsCopy,
  legal: legalCopy,
} as const;
