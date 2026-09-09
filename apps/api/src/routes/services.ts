import type { DashboardService } from "../services/dashboards.js";
import type { OrganizationEmbeddingsService } from "../services/organization-embeddings.js";
import type { SimilarService } from "../services/similar.js";
import type { BillingService } from "../services/billing.js";
import type { SessionEventsService } from "../services/session-events.js";
import type { AuthService } from "../services/auth.js";
import type { MembershipService } from "../services/membership.js";
import type { SearchService } from "../services/search.js";
import type { SessionService } from "../services/session.js";
import type { QueryService } from "../services/query.js";
import type { IngestService } from "../services/ingest.js";
import type { PolicyService } from "../services/policies.js";
import type { HealthService } from "../services/health.js";
import type { AuditService } from "../services/audit.js";
import type { AdminService } from "../services/admin.js";
import type { JobService } from "../services/jobs.js";

export interface Services {
  dashboards: DashboardService;
  organizationEmbeddings: OrganizationEmbeddingsService;
  billing: BillingService;
  similar?: SimilarService;
  events: SessionEventsService;
  jobs: Pick<JobService, "progress">;
  auth: AuthService;
  members: MembershipService;
  search: SearchService;
  sessions: SessionService;
  query: QueryService;
  ingest: IngestService;
  policies: PolicyService;
  health: HealthService;
  audit: AuditService;
  admin: AdminService;
}

/** Route handlers run only on a live instance; the contract build registers routes without services. */
export function requireServices(services: Services | undefined): Services {
  if (!services)
    throw new Error("This instance only generates the API contract.");
  return services;
}
