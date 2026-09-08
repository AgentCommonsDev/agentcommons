# Infrastructure operation

Use the `dev` and `prod` stacks. The stack files contain only public defaults. Set
`hostname`, `githubRepository` (`owner/repository`), `githubOidcProviderArn`, and either
`hostedZoneId` (the program issues and validates ACM) or an already issued
`certificateArn` (manage DNS outside Route53). Region is `aws:region`.

Set each password with `pulumi config set --secret`: `databaseMigrationPassword`,
`databaseAppPassword`, `databaseTraceControlPassword`
(at least 16 characters), and `betterAuthSecret` (at least 32 characters).
`applicationSecrets` is a secret JSON object for IdP and embedding credentials,
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and credential-bearing `SMTP_URL`.
These values must not be placed in the plain `environment` object.
`environment` is a plain JSON object for non-secret Appendix B configuration.
Application database URLs are generated and held in Secrets Manager. The migration
credential is available only to the migration task. Migrations create the control-plane tables and application/control-reader roles.
ClickHouse credentials are `clickhouseAdminPassword`, `clickhouseWriterPassword`,
`clickhouseAccessPassword` (at least 16 characters), and `clickhouseReaderSecret`
(at least 32 characters). Trace data is stored on the private ClickHouse host; PostgreSQL
16 stores auth, organization, billing and job controls. Do not use production credentials for local tests.

For SaaS, set `environment.INSTANCE_MODE=saas`, the Free and included Pro record allowances, the native Pro/enhanced
primary prices and both metered prices/rates listed in Appendix B, and an optional HTTPS `CAL_COM_URL`. SMTP delivery uses
`EMAIL_TRANSPORT=smtp`, `EMAIL_FROM`, and the secret `SMTP_URL`. SES delivery uses
`EMAIL_TRANSPORT=ses`, `EMAIL_FROM`, and an explicit `sesIdentityArn` for an already
verified SES email or domain identity in the sending region. The API task gets only
`ses:SendEmail` on that identity, restricted to the configured From address. The migration
task has a separate role without mail permission; no mail policy is attached when SES
is disabled. This follows [AWS SES identity and sender policy controls](https://docs.aws.amazon.com/ses/latest/dg/control-user-access.html). Configuring SES does not verify a sender or remove the account's sandbox
restrictions. Complete those provider prerequisites before enabling public signup.

The image retains the dashboard's SSR renderer and template. SaaS public HTML is rendered
at API startup from the same validated runtime plan configuration used for admission;
changing allowances does not require rebuilding the image. Native Stripe dependency
patches are installed from the tracked `patches/` directory during the frozen image build.

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
