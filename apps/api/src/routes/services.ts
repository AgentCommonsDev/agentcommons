import type { OrganizationEmbeddingsService } from "../services/organization-embeddings.js";
import type { SimilarService } from "../services/similar.js";
import type { BillingService } from "../services/billing.js";
import type { SessionEventsService } from "../services/session-events.js";
import type { jobProgressSchema } from "@agentcommons/core";
import type { z } from "zod";
import type { AuthService } from "../services/auth.js";
import type { MembershipService } from "../services/membership.js";
import type { SearchService } from "../services/search.js";
import type { SessionService } from "../services/session.js";
import type { QueryService } from "../services/query.js";
import type { IngestService } from "../services/ingest.js";
import type { PolicyService } from "../services/policies.js";
import type { HealthService } from "../services/health.js";
import type { AuditService } from "../services/audit.js";
import type { ServiceContext, ServiceResult } from "../services/context.js";

export interface AdminOperations {
  metrics(
    context: ServiceContext,
    group: unknown,
    input: unknown,
  ): Promise<ServiceResult<unknown>>;
  setInstallationTools(
    context: ServiceContext,
    installationId: string,
    input: unknown,
  ): Promise<ServiceResult<unknown>>;
  setVisibility(
    context: ServiceContext,
    input: unknown,
  ): Promise<ServiceResult<unknown>>;
  purge(
    context: ServiceContext,
    input: unknown,
  ): Promise<ServiceResult<unknown>>;
  auditLog(
    context: ServiceContext,
    input: unknown,
  ): Promise<ServiceResult<unknown>>;
  status(context: ServiceContext): Promise<ServiceResult<unknown>>;
  rescan(
    context: ServiceContext,
    input: unknown,
  ): Promise<ServiceResult<unknown>>;
}
export interface Services {
  dashboards: DashboardService;
  organizationEmbeddings: OrganizationEmbeddingsService;
  billing: BillingService;
  similar?: SimilarService;
  events: SessionEventsService;
  jobs: {
    progress(
      context: ServiceContext,
      id: string,
    ): Promise<ServiceResult<z.infer<typeof jobProgressSchema>>>;
  };
  auth: AuthService;
  members: MembershipService;
  search: SearchService;
  sessions: SessionService;
  query: QueryService;
  ingest: IngestService;
  policies: PolicyService;
  health: HealthService;
  audit: AuditService;
  admin: AdminOperations;
}
import type { DashboardService } from "../services/dashboards.js";
