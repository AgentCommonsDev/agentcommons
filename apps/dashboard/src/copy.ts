import { publicCopy } from "./copy/public";
import { appCopy } from "./copy/app";
import { authCopy } from "./copy/auth";
import { billingCopy } from "./copy/billing";
import { dashboardsCopy } from "./copy/dashboards";
import { sessionsCopy } from "./copy/sessions";
import { installCopy } from "./copy/install";
import { keysCopy } from "./copy/keys";
import { apiReferenceCopy } from "./copy/api-reference";
import { sqlCopy } from "./copy/sql";
import { adminCopy } from "./copy/admin";
import { redactionActivityCopy } from "./copy/redaction";
import { settingsCopy } from "./copy/settings";
import { legalCopy } from "./copy/legal";
export { links } from "./copy/public";
export type { LegalDocument } from "./copy/legal";

/**
 * Every string a person reads in the dashboard, one namespace per area. The public site
 * and hosted-account strings live under `site`; the authenticated app is split per area.
 */
export const copy = {
  site: publicCopy,
  app: appCopy,
  auth: authCopy,
  billing: billingCopy,
  dashboards: dashboardsCopy,
  sessions: sessionsCopy,
  install: installCopy,
  keys: keysCopy,
  apiReference: apiReferenceCopy,
  sql: sqlCopy,
  admin: { ...adminCopy, redactionActivity: redactionActivityCopy },
  settings: settingsCopy,
  legal: legalCopy,
} as const;
