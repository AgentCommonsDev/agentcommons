# 0007. Deploy to AWS with Pulumi (TypeScript, @pulumi/awsx)

Date: 2026-09-07 · Status: accepted

**Context.** The first deployment is ZeroPath's; their infrastructure is on AWS and managed
with Pulumi. The project must also be self-hostable by others.

**Decision.** `infra/` holds Pulumi stacks `dev` and `prod` using `@pulumi/awsx` for VPC,
Fargate service, and ALB; RDS PostgreSQL 16 with `vector` and `pg_trgm`; Secrets Manager;
CloudWatch. A single container serves API, MCP, auth, and the dashboard. Docker Compose is
provided for local development and simple self-hosting.

**Alternatives.** GCP Cloud Run + Cloud SQL (the workstation lives on GCP, the company does not);
a single VM with compose (fine for tiny installs, provided via compose anyway).

**Consequences.** Hostname, account, and DNS zone are stack config; nothing organization-
specific is in code.
