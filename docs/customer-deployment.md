# Goodhart Labs customer deployment

Status: single-node plan prepared 2026-09-09 (stack `zpghl`, `deployment: single-node`,
us-west-2, `pulumi preview` reviewed). No application resources exist until the operator
runs `pulumi up`; only the private Pulumi state bucket has been created. The Fargate plan
below remains the reference for a larger footprint and was not selected.

## Selected plan: one host behind Caddy

`infra/OPERATIONS.md` (section "Single-node deployment") is the runbook. Summary:

| Setting                  | Value                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------ |
| Application origin       | `https://hooks.tools.goodhartlabs.com`                                               |
| Pulumi stack             | `zpghl`, S3 state backend in the account, passphrase secrets provider                |
| Region                   | `us-west-2`, default VPC public subnet                                               |
| Host                     | arm64 Ubuntu 24.04 `t4g.large`, 60 GiB encrypted gp3, Elastic IP, IMDSv2             |
| Access                   | HTTPS and HTTP only; SSM Session Manager, no SSH                                     |
| DNS                      | Cloudflare-proxied record to the Elastic IP; Caddy trusts Cloudflare's ranges        |
| Instance mode            | `customer`, Google sign-in plus the owner's password fallback, no email              |
| Signup                   | `invite`; operator allowlist `zeropath.com,goodhartlabs.com`                         |
| Organization             | slug and name `zpghl`; owner `raphael@zeropath.com`                                  |
| Enrolled sign-in domains | `zeropath.com`, `goodhartlabs.com` (members join automatically, ADR 0049)            |
| Embeddings               | off; enable later per the runbook (`EMBEDDINGS_ENABLED`, `OPENAI_API_KEY`)           |
| Trace store              | ClickHouse Cloud (`cjudcc6tio.us-west-2.aws.clickhouse.cloud`), billed by ClickHouse |
| Backups                  | daily EBS snapshots, seven retained                                                  |
| Estimated cost           | about $59 to $61 per month                                                           |

Operator sequence after the final commit is pushed: `pulumi up`, then
`infra/scripts/single-node-release.sh <commit>`, then
`infra/scripts/single-node-run.sh bootstrap.sh --admin raphael@zeropath.com --organization zpghl --name zpghl --domain zeropath.com --domain goodhartlabs.com`.

Founder actions: keep the Cloudflare-proxied `A` record for `hooks.tools` pointing at the
`publicIp` stack output (DNS-only also works), set the zone's SSL/TLS mode to Full
(strict) once the certificate exists, leave "Always Use HTTPS" off, and add
`https://hooks.tools.goodhartlabs.com/auth/callback/google` to the Google OAuth client's
authorized redirect URIs (origin `https://hooks.tools.goodhartlabs.com`). Caddy obtains
the certificate within a minute of the record resolving.

## Fargate alternative (not selected)

The remainder of this document is the earlier Fargate/RDS plan, kept for reference.

## Target and verified prerequisites

| Setting                   | Proposed value                                                                          |
| ------------------------- | --------------------------------------------------------------------------------------- |
| Application origin        | `https://hooks.tools.goodhartlabs.com`                                                  |
| Instance mode             | `customer`                                                                              |
| AWS region                | `us-west-2` (Oregon)                                                                    |
| AWS account               | Discover as `AWS_ACCOUNT_ID` using the command below                                    |
| GitHub repository         | `rek7/agentcommons`                                                                     |
| GitHub OIDC provider      | `arn:aws:iam::<AWS_ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com`       |
| OIDC audience             | `sts.amazonaws.com`                                                                     |
| Recommended initial stack | `<PULUMI_OWNER>/agentcommons/prod`                                                      |
| Application organization  | Bootstrap one organization, suggested slug `goodhartlabs`, display name `Goodhart Labs` |
| First owner               | Operator-provided email; remains an owner, not an automatically assigned member         |

Before preparing the stack, verify the active AWS identity and selected Pulumi backend.
Keep the resulting account, identity, and inventory details in private operator notes.

```sh
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
pulumi whoami
```

Use the selected account to inspect its GitHub OIDC provider and confirm the
`sts.amazonaws.com` audience. Reuse an existing provider when present. Confirm whether
an AgentCommons stack and a matching regional ACM certificate already exist before
creating either. The VPC uses `10.42.0.0/16`; check the target account's VPC inventory
before approving a preview.

The domain uses Cloudflare DNS. The plan below therefore uses the existing
external-DNS path. Inspect the hostname's current records before changing them. If
workstation policy requires a Tailscale AWS exit route, establish it before running
AWS commands; the deployed application itself uses its VPC and NAT gateways.

## DNS and TLS

Keep DNS in Cloudflare and use the infrastructure's existing external-certificate path.
There is no need to migrate or delegate the zone to Route53.

1. After approval, request a public ACM certificate for the exact hostname
   `hooks.tools.goodhartlabs.com` in `us-west-2`, using DNS validation.
2. Read ACM's actual `ResourceRecord.Name` and `ResourceRecord.Value`. Add that CNAME
   in Cloudflare, DNS-only. Its generated token cannot be supplied before the certificate
   request. Keep this validation record for certificate renewal.
3. Wait for ACM status `ISSUED`, then set `agentcommons:certificateArn` to that ARN.
   Leave `hostedZoneId` unset. The current Pulumi program consumes this certificate and
   does not attempt to create Route53 records.
4. Provision the reviewed stack. Read the resulting ALB DNS hostname and add:

   | Cloudflare field                    | Value                                                              |
   | ----------------------------------- | ------------------------------------------------------------------ |
   | Type                                | `CNAME`                                                            |
   | Name in the `goodhartlabs.com` zone | `hooks.tools`                                                      |
   | Target                              | The actual generated ALB hostname in `us-west-2.elb.amazonaws.com` |
   | Proxy                               | DNS-only                                                           |
   | TTL                                 | Auto                                                               |

An ALB provides a DNS name whose addresses can change. Do not pin one of its resolved
IP addresses in an A record. Read the generated hostname after provisioning.
AWS documents [ALB domain routing](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/application-load-balancers.html)
and how [load-balancer address changes are handled by DNS aliases](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resource-record-sets-choosing-alias-non-alias.html).

Read the generated target with `pulumi stack output loadBalancerDnsName` after
selecting and provisioning the `prod` stack. This output comes directly from
the ALB; exporting it adds no resource.

## Google SSO and customer membership

Create a Google OAuth client with application type **Web application**. The production
JavaScript origin is `https://hooks.tools.goodhartlabs.com`. Its exact authorized
redirect URI is:

```text
https://hooks.tools.goodhartlabs.com/auth/callback/google
```

For the existing local development command, the dashboard runs on port 5173 and proxies
`/auth` to the API on port 3000. With `PUBLIC_URL=http://localhost:5173`, register:

```text
JavaScript origin: http://localhost:5173
Redirect URI:      http://localhost:5173/auth/callback/google
```

If testing the built application directly through the API, use
`PUBLIC_URL=http://localhost:3000` and register `http://localhost:3000` plus
`http://localhost:3000/auth/callback/google`. Merely listening on API port 3000 does not
change the callback while `PUBLIC_URL` remains 5173. These paths follow the configured
Better Auth `basePath: "/auth"`; they are not `/api/auth/callback/google`.
[Better Auth's Google guide](https://github.com/better-auth/better-auth/blob/main/docs/content/docs/authentication/google.mdx)
documents matching the redirect URI to the configured base URL and path.

The client ID and secret go into encrypted Pulumi `applicationSecrets`, then AWS Secrets
Manager. Never commit the supplied values or put the client secret in plain `environment`.
The intended non-secret settings are:

```yaml
INSTANCE_MODE: customer
AUTH_EMAIL_PASSWORD_ENABLED: "false"
AUTH_SOCIAL_PROVIDER: google
AUTH_ALLOWED_EMAIL_DOMAINS: goodhartlabs.com
AUTH_SIGNUP_MODE: open
EMBEDDINGS_ENABLED: "false"
```

The operator allowlist restricts which email domains may sign in and rejects unverified
OAuth identities. Membership comes from the organization's sign-in domains: an owner or
admin adds `goodhartlabs.com` on **Admin → Settings** (or the operator runs
`pnpm db:domain` with a real owner session), and every Google-verified login from that
exact domain then joins the organization as `member`. No DNS record is required (ADR
0049). Existing roles, suspensions and removals are preserved.

## Non-secret Pulumi configuration draft

The following is a review draft, not an executable checked-in stack file. The certificate
placeholder must be replaced with the issued regional certificate ARN.

```yaml
config:
  aws:region: us-west-2
  agentcommons:hostname: hooks.tools.goodhartlabs.com
  agentcommons:githubRepository: rek7/agentcommons
  agentcommons:githubOidcProviderArn: arn:aws:iam::<AWS_ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com
  agentcommons:certificateArn: <issued-us-west-2-ACM-certificate-ARN>
  agentcommons:databaseInstanceClass: db.t4g.small
  agentcommons:environment:
    INSTANCE_MODE: customer
    AUTH_EMAIL_PASSWORD_ENABLED: "false"
    AUTH_SOCIAL_PROVIDER: google
    AUTH_ALLOWED_EMAIL_DOMAINS: goodhartlabs.com
    AUTH_SIGNUP_MODE: open
    EMBEDDINGS_ENABLED: "false"
```

The operator generates `databaseMigrationPassword`, `databaseAppPassword`,
`databaseReaderUserPassword`, `databaseReaderAdminPassword`, and `betterAuthSecret` and
stores them as Pulumi secrets. They are deployment work, not additional values the user
must invent. `applicationSecrets` contains `AUTH_GOOGLE_CLIENT_ID` and
`AUTH_GOOGLE_CLIENT_SECRET`. The existing stack derives all four database URLs itself.

## Stack identity and resource choices

For the first customer instance, using the existing `prod` stack requires no new stack
model. The application organization supplies the customer identity. Recommend this
option now, with no public-site stack or additional tenant infrastructure.

Keep the deployment stack named `prod`; customer identity belongs to the application
organization. No new stack naming model or tenant infrastructure is needed.

Current infrastructure choices, using 730 hours per month and on-demand Oregon prices
queried from the AWS Price List API on 2026-09-08:

| Resource                      | Recommended `prod`                                   | Existing smaller `dev`                               |
| ----------------------------- | ---------------------------------------------------- | ---------------------------------------------------- |
| API tasks                     | 2 × 0.5 vCPU / 1 GiB, about $36.04/month             | 1 × 0.5 vCPU / 1 GiB, about $18.02/month             |
| PostgreSQL 16                 | `db.t4g.small`, Multi-AZ, about $47.45/month         | `db.t4g.micro`, Single-AZ, about $11.68/month        |
| Initial encrypted gp3 storage | 20 GiB, about $4.60/month                            | 20 GiB, about $2.30/month                            |
| NAT gateways                  | 2, about $65.70/month before data processing         | 1, about $32.85/month before data processing         |
| ALB base hours                | About $16.43/month                                   | About $16.43/month                                   |
| Public IPv4 baseline          | 2 NAT + at least 2 ALB addresses, about $14.60/month | 1 NAT + at least 2 ALB addresses, about $10.95/month |
| Listed baseline subtotal      | About **$185/month**                                 | About **$92/month**                                  |
| Backups/protection            | 35 days, deletion protection and final snapshot      | 7 days, no production deletion protection            |

The subtotal excludes ALB capacity units, NAT processing, internet transfer, additional
public addresses, storage growth/backups beyond included allowance, ECR, Secrets
Manager, CloudWatch, and short migration tasks. Rates used are Fargate $0.04048/vCPU-hour
and $0.004445/GiB-hour, RDS $0.065/$0.016 per instance-hour, gp3 $0.23/$0.115 per GiB-month,
NAT $0.045/hour, ALB $0.0225/hour, and public IPv4 $0.005/address-hour. This is a baseline
estimate, not a cap. See [Fargate pricing](https://aws.amazon.com/fargate/pricing/),
[RDS PostgreSQL pricing](https://aws.amazon.com/rds/postgresql/pricing/),
[VPC pricing](https://aws.amazon.com/vpc/pricing/), and
[ALB pricing](https://aws.amazon.com/elasticloadbalancing/pricing/).

## Remaining operator work and release sequence

User inputs needed are the Google client ID/secret, the first owner's email, and
creation of the two Cloudflare CNAME records when their actual values are available.
An operations email for alarm delivery can be the first owner's email if desired.

Inspect the repository deployment environments, variables, and secret names before
automated releases. Configure
`dev`/`prod` environments, main-branch restrictions, required production review,
`AWS_REGION`, `AWS_DEPLOY_ROLE_ARN`, `PULUMI_STACK`, and the Pulumi backend credential.
Keep `DEPLOYMENTS_ENABLED` unset until the reviewed first deployment is authorized.
Reuse the verified AWS OIDC provider; the first operator-driven update creates the
application-specific deployment role. Use the operator-selected Pulumi backend and
keep its credential out of this document.

After the SSO enrollment change and hosted verification pass: collect the missing
Google/owner inputs, prepare encrypted stack configuration, request and validate ACM,
run a real Pulumi preview, and review its resource/cost plan. Only then apply the stack.
The existing migration task must exit successfully before ECS updates the API. Publish
the ALB CNAME, bootstrap the first owner/organization, and verify HTTPS readiness,
allowed and denied Google logins, ordinary member authority, dashboard access, and a
real installed-hook upload found through MCP. Never place the migration database URL
in the API task. No deployment is complete merely because DNS or ECS is healthy.
