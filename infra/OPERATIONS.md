# Infrastructure operation

Use the `dev` and `prod` stacks. The stack files contain only public defaults. Set
`hostname`, `githubRepository` (`owner/repository`), `githubOidcProviderArn`, and either
`hostedZoneId` (the program issues and validates ACM) or an already issued
`certificateArn` (manage DNS outside Route53). Region is `aws:region`.

Set each password with `pulumi config set --secret`: `databaseMigrationPassword`,
`databaseAppPassword`, `databaseReaderUserPassword`, `databaseReaderAdminPassword`
(at least 16 characters), and `betterAuthSecret` (at least 32 characters).
`applicationSecrets` is a secret JSON object for IdP and embedding credentials.
`environment` is a plain JSON object for non-secret Appendix B configuration.
Application database URLs are generated and held in Secrets Manager. The migration
credential is available only to the migration task. Migrations create the extensions
and application/reader roles. Do not use production credentials for local tests.

The first update uses the operator's AWS credentials and creates the GitHub deployment
role. The account must already have GitHub's OIDC provider. Configure GitHub environments
`preview`, `dev`, and `prod`; restrict deployments to `main` in dev/prod, and require
reviewers in prod. GitHub environment protection is an external prerequisite: a YAML
`environment` declaration alone does not require approval. Set environment variables
`AWS_REGION`, `AWS_DEPLOY_ROLE_ARN`, `PULUMI_STACK`, and secret `PULUMI_ACCESS_TOKEN`.
The preview environment uses a separate read-only OIDC role scoped to
`repo:OWNER/REPOSITORY:environment:preview`, `AWS_PREVIEW_ROLE_ARN`, and
`PULUMI_DEV_STACK`. Do not grant the preview role deployment privileges. Fork previews
run local tests only because untrusted code cannot receive AWS credentials.

Pull requests preview dev. Deployment is disabled until the repository variable `DEPLOYMENTS_ENABLED` is `true`.
Leave it unset while validating the application locally. After operator enablement,
a successful main CI run deploys its exact commit to dev.
Manual releases from main run verification and use the selected environment; prod
waits for its required reviewer. Pulumi builds one image, starts an isolated migration
Fargate task, waits for exit status zero, then updates the service. A migration failure
or timeout fails the update and leaves the service on its prior task definition.
Database migrations must remain compatible with the prior service during this interval.
The migration gate re-runs when its image, task definition, or secret version changes.
Failed tasks log to the CloudWatch `migration` stream. An update rollback does not roll
back database migrations.

Both stacks use private tasks and databases. Dev has one NAT gateway; prod has one per
AZ. Production enables Multi-AZ, 35-day backup retention, deletion protection, and
Pulumi resource protection. Subscribe an operations address through `alarmEmail` and
confirm the SNS subscription, or subscribe another receiver to the exported topic ARN.
A manually supplied certificate requires a DNS record pointing to the ALB.

Local static validation is `pnpm --filter @agentcommons/infra typecheck` and
`pnpm --filter @agentcommons/infra test`. Mocks check resource arguments and the migration
failure gate, not AWS provisioning. A real `pulumi preview --stack dev` additionally
requires stack configuration, backend access, provider plugins, and AWS credentials.
