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

## Single-node deployment

For one small self-hosted instance with a fixed address, set `deployment: single-node`
on a stack (ADR 0055). The same program then creates, in the default VPC of `aws:region`:
a security group admitting only 80 and 443, an instance role (SSM Session Manager, read
access to one private release bucket and to the stack's SSM parameters), one arm64
Ubuntu 24.04 `t4g.large` with a 60 GiB encrypted gp3 root volume and IMDSv2 required, an
Elastic IP, and a Data Lifecycle Manager policy keeping seven daily snapshots. There is
no load balancer, NAT gateway, RDS instance or Secrets Manager secret, and no SSH. The
host runs `docker-compose.yml` with `docker-compose.caddy.yml`: Caddy serves
`https://<hostname>` with an automatic Let's Encrypt certificate, retrying until the DNS
A record points at the Elastic IP, and answers plain HTTP on the bare address so the host
can be checked before DNS exists. The API receives `TRUST_PROXY=uniquelocal`, so Better
Auth sees HTTPS and sets secure cookies.

Configuration: `hostname`; optional `instanceType` (`t4g.medium`, `t4g.large`,
`t4g.xlarge`), `volumeSize` (GiB, 40 to 1000) and `snapshotRetention` (1 to 35); the
`environment` object; `applicationSecrets` (set each key with
`pulumi config set --path applicationSecrets.KEY --secret`); and the same password
secrets as the Fargate stacks (`databaseMigrationPassword` becomes `POSTGRES_PASSWORD`).
The program renders the complete Compose `.env` (database URLs on host `db`, ClickHouse
on `clickhouse`, `PUBLIC_URL=https://<hostname>`) into SecureString parameters under
`/agentcommons/<stack>/env/`. Values may not contain a single quote or line break. Keep
the state in a private S3 bucket with the passphrase secrets provider; this stack does
not use Pulumi Cloud:

```sh
export PATH="$HOME/.pulumi/bin:$PATH"
export PULUMI_BACKEND_URL='s3://<state-bucket>?region=us-west-2'
export PULUMI_CONFIG_PASSPHRASE_FILE=~/.agentcommons-deploy/passphrase
export PULUMI_STACK=zpghl
pulumi -C infra preview --stack "$PULUMI_STACK"
```

Provision, release and bootstrap in that order:

```sh
pulumi -C infra up --stack "$PULUMI_STACK"
infra/scripts/single-node-release.sh <commit>
infra/scripts/single-node-run.sh bootstrap.sh --admin owner@example.com \
  --organization team --name "Team" --domain example.com --domain example.org
```

`up` creates the host, which installs Docker and waits for a release. The release script
uploads `git archive` of the commit to the release bucket, then runs the host's release
wrapper through SSM Run Command: it unpacks the source into `/opt/agentcommons/app`,
renders `.env` from the parameters (plus `COMPOSE_FILE` naming the Compose files), pulls
the published image `AGENTCOMMONS_IMAGE` (default
`ghcr.io/agentcommonsdev/agentcommons:stable`, ADR 0059), runs `docker compose up -d`
(PostgreSQL and ClickHouse migrations, API, Caddy), waits for `/ready`, and installs the
hourly updater described below. A release takes a minute or two. `single-node-release.sh
<commit> --build` builds the image on the host instead (ten to fifteen minutes on a
`t4g.large`, using the swapfile) for a host that cannot reach the registry. After a
configuration change, run `pulumi up` and then the release script with the current commit
to re-render `.env` and restart. Run the release script for changes to the checkout itself
(Compose files, Caddy and database configuration, host scripts); application releases
arrive on their own.

Automatic updates. `.github/workflows/release.yml` publishes an image for every commit on
`main` whose CI run succeeded, tagged `sha-<12-hex commit>` and `stable`, signed with
Sigstore. On the host, `agentcommons-update.timer` runs
`/opt/agentcommons/agentcommons-update.sh` every hour with a random delay of up to 15
minutes: it pulls the configured image, does nothing when its digest matches the running
API, and otherwise keeps the running image as `agentcommons:previous`, starts the stack
(the migration runs first), waits for `/ready`, and if the new release does not come up
restores the previous image and exits non-zero. A failed release is held until a newer one
is published. Database migrations are not rolled back, so migrations must stay compatible
with the previous image. Useful commands on the host (`aws ssm start-session`):

```sh
/opt/agentcommons/agentcommons-update.sh --status   # running version, images, last result
/opt/agentcommons/agentcommons-update.sh --now      # check and update now, even when opted out
journalctl -u agentcommons-update.service -n 50     # the timer's log
```

The stack setting `autoUpdate` (default `true`) renders `AUTO_UPDATE` into `.env`; with
`false` the timer keeps running but every run is a no-op. Set it at install
(`pulumi config set autoUpdate false` before the first release) or later (the same command,
then `pulumi up` and the release script with the current commit); editing `.env` on the host
lasts only until the next release re-renders it. To pin a release, set
`environment.AGENTCOMMONS_IMAGE` to `ghcr.io/agentcommonsdev/agentcommons:sha-<12 hex>`
(the version Admin → Status shows) and release; clear it to follow `stable` again. Admin →
Status shows the running version and whether automatic updates are on. A host created
before ADR 0059 gets the updater from its next release.

`single-node-run.sh` copies this checkout's `infra/scripts/single-node/bootstrap.sh`
to the release bucket and runs it on the host, so bootstrap tooling follows the operator's
checkout while the application stays the released code. It seeds the owner and organization with `db:seed` (idempotent),
completes the owner's one-time setup link with a generated password through the native
password endpoints, signs in, and uses that owner session for `db:domain`, which
allowlists each Google sign-in domain for the organization (ADR 0049). The link and
password exist only in `/root/agentcommons/owner-bootstrap.json` on the host (mode 600);
SSM command output never contains them. The owner normally signs in with Google; the
stored password is a fallback, and `pnpm db:recover --email` issues a new setup link.
`infra/scripts/single-node-run.sh isolation-check.sh --organization zpghl --probe-organization
isolation-probe --probe-admin someone@example.com` creates a second organization on the
host and proves its owner sees none of the first organization's sessions through the
session list, SQL and a direct fetch (exit 2 while the first organization has no sessions).
`--key NAME` (repeatable) mints an organization API key with `sessions` read and ingest
through the owner session once and stores it in `/root/agentcommons/NAME-key`; re-runs
skip keys whose file exists. `infra/scripts/single-node-run.sh revoke-key.sh --organization
zpghl --key NAME --reason "why"` revokes such a key through the owner session and deletes
its file; Admin → Keys works too. `infra/scripts/single-node-run.sh add-members.sh
--organization zpghl --role admin someone@example.com` seats people with one role through the
owner session before they sign in (the People page makes the same call); an enrolled
Google domain still lets colleagues join as members on their own.
With `AUTH_SIGNUP_MODE=invite`, a Google account may sign in only when its exact email
domain is enrolled by exactly one organization and, if `AUTH_ALLOWED_EMAIL_DOMAINS` is
set, also listed there; it then joins that organization as `member`.

Google Cloud console: the OAuth client must list
`https://<hostname>/auth/callback/google` as an authorized redirect URI and
`https://<hostname>` as an authorized JavaScript origin. DNS: one A record for the
hostname pointing at the `publicIp` output, proxied through Cloudflare or DNS-only (see
below).

DNS and Cloudflare. The hostname may be a Cloudflare-proxied record (orange cloud, the
default and the zpghl setting) or a plain A record to the Elastic IP; `environment.
CADDY_TRUSTED_PROXIES` selects the mode. `cloudflare` (also the value when unset): at
every start Caddy's entrypoint (`infra/caddy/entrypoint.sh`) fetches Cloudflare's
published IPv4 and IPv6 ranges, validates them, trusts them as proxies and reads the
client address from `CF-Connecting-IP`; if the fetch fails it uses the last fetched list
from its data volume and, before any fetch has succeeded, `infra/caddy/cloudflare-ranges.txt`
shipped with the release, logging which list it used (`docker compose logs caddy`). Every
release restarts Caddy, so the list is refreshed at least that often. `none`: trust no
proxy, for DNS-only records; forwarded headers from any client are ignored. Any other
value is a literal space-separated CIDR list for a different proxy, with the client read
from `X-Forwarded-For`. In every mode Caddy rewrites `X-Forwarded-For` to the single
resolved client address before proxying, so the API keeps `TRUST_PROXY=uniquelocal`,
trusts only Caddy, and records real client addresses; a direct client is never inside
Cloudflare's ranges, so its forwarded headers are ignored.

Certificates come from Let's Encrypt over HTTP-01 in both cases: Cloudflare forwards
`/.well-known/acme-challenge/` to the origin over plain HTTP (verified on this zone: the
edge answered 521 from the origin rather than redirecting), so leave the zone's "Always
Use HTTPS" off; Caddy performs the HTTPS redirect itself. TLS-ALPN cannot pass the proxy
and Caddy falls back to HTTP-01 on its own. Founder-side Cloudflare settings: proxied
record allowed; SSL/TLS mode Full (strict) once the certificate exists (about a minute
after the first release; until then the edge shows 526). Flexible mode must not be used:
Cloudflare would reach the origin over HTTP, Caddy's redirect would loop, and secure
cookies would break. Leave Rocket Loader and minification off for this hostname. If
HTTP-01 through the proxy ever proves unreliable, the fallback is DNS-01 with a scoped
Cloudflare API token held as a Pulumi secret and a Caddy build with the Cloudflare DNS
module; that is not built today.

Cloudflare closes responses idle for 100 s. The session live stream is a server-sent
event stream the browser reopens automatically when it closes, and the transcript view
polls while the stream is not connected, so a cut stream degrades to polling and
resumes. MCP tool calls are answered as JSON, not streams. Hook uploads are batches of at
most 512 KiB and the API refuses bodies over 50 MB, well under Cloudflare's 100 MB limit.

Enabling embeddings later (OpenAI, the shipped defaults for model and dimensions):

```sh
pulumi -C infra config set --stack "$PULUMI_STACK" --path environment.EMBEDDINGS_ENABLED --type string true
printf '%s' 'sk-...' | pulumi -C infra config set --stack "$PULUMI_STACK" --path applicationSecrets.OPENAI_API_KEY --secret
pulumi -C infra up --stack "$PULUMI_STACK"
infra/scripts/single-node-release.sh <deployed-or-newer-commit>
```

Then an organization owner turns embeddings on for the organization on Admin → Settings.
Setting `EMBEDDINGS_ENABLED=false` again and re-running the last two steps disables them.

Operations: `aws ssm start-session --region <region> --target <instanceId>` opens a shell.
The application is `/opt/agentcommons/app` (`docker compose -p agentcommons -f
docker-compose.yml -f docker-compose.caddy.yml logs`), release logs are in
`/var/log/agentcommons/`, first-boot output is in `/var/log/cloud-init-output.log`,
`/opt/agentcommons/current-commit` names the deployed checkout, and
`/opt/agentcommons/agentcommons-update.sh --status` names the running release. The instance is protected
in Pulumi and ignores image and first-boot changes because its root volume holds the
data; replacing it means `pulumi state unprotect`, then restoring the latest DLM snapshot
into a new volume. Outputs: `url`, `publicIp`, `instanceId`, `releaseBucket`,
`parameterPath`, `region`.

Trace store. `traceStore: local` (default) runs ClickHouse in the Compose stack.
`traceStore: clickhouse-cloud` with `clickhouseCloudUrl`
(`https://<id>.<region>.<provider>.clickhouse.cloud:8443`) uses a ClickHouse Cloud
service instead: the release adds `docker-compose.clickhouse-cloud.yml`, which parks the
local `clickhouse` service behind a profile and points the API and the migration at the
Cloud endpoint; `clickhouseAdminPassword` is then the Cloud `default` user's password
(`CLICKHOUSE_MIGRATION_USER=default`), and the migration creates the writer and access
users, roles, row policies, dictionaries and views there as it does locally. Cloud must
read this host's PostgreSQL control tables and dictionaries (ADR 0047), so in this mode
PostgreSQL is published on 5432 with TLS: the release issues a certificate for the public
address (`/opt/agentcommons/postgres-tls`, SAN = Elastic IP and `db`), renders a
`pg_hba.conf` that admits only `ac_trace_control` over `hostssl` from ClickHouse Cloud's
egress addresses for that provider/region plus the Compose network, and the security
group opens 5432 to exactly those addresses. With `clickhouseCloudPostgresTls:
verify-full` the migration hands Cloud the certificate inline (`sslmode=verify-full`,
`sslrootcert` on `DATABASE_TRACE_CONTROL_URL`); the release ends with a `dictGet` probe
from Cloud that fails the release if Cloud cannot reach PostgreSQL. The egress list is the reviewed snapshot
`infra/compose/clickhouse-cloud-egress.json`; when ClickHouse announces new addresses,
run `infra/scripts/clickhouse-cloud-egress.sh`, review the diff, `pulumi up` and release.
Cloud mode is not usable on the current ClickHouse Cloud release (2026-09-09, service
version 26.2). The former stemming blocker is gone: the search index no longer uses
`stem()`. Two rejections remain on that service: `WITH … AS MATERIALIZED` (used by the
analytics views, `apps/api/src/services/metrics.ts` and the reader-principal settings in
`packages/traces/src/client.ts`), and every PostgreSQL TLS key-value argument
(`sslmode`, `sslrootcert`) on the PostgreSQL engine, so certificate verification of this
host is not possible there yet. `clickhouseCloudPostgresTls` therefore defaults to
`default`, which emits no libpq option: libpq still prefers TLS and the host's
`pg_hba.conf` admits Cloud only over `hostssl`, so the link is encrypted but the host
certificate is unverified; set `verify-full` (or `require`) once the service accepts the
arguments. Two paths forward: run the Cloud service on a release that supports
materialized CTEs, or drop `AS MATERIALIZED` from the views and settings after re-running
the metrics review suites. The password policy is already satisfied by the shared
`CLICKHOUSE_PASSWORD_SUFFIX` (view owner, reader principals, validated writer/access
secrets). The zpghl stack runs `traceStore: local` until then; the objects the partial
migration created on the Cloud service (`ac_trace`, `api_ro`, three `ac_trace_*` users,
ten tables) are left in place for that switch.
Cloud is billed by ClickHouse separately from the AWS estimate below; egress from Cloud to
this host is small (dictionary lookups). The workstation's resolver sometimes fails for
`*.clickhouse.cloud`; `dig @1.1.1.1` and `curl --resolve` work around it.

Capacity and alarms. The Compose override limits memory so one service cannot starve the
others on the 8 GiB host: ClickHouse 3.5 GiB when it runs locally (server limit 3 GiB,
2 GiB and 60 s per query, 32 concurrent queries, small caches;
`infra/compose/clickhouse-*.xml`; not applicable in Cloud mode), PostgreSQL 1 GiB
(`shared_buffers=256MB`, `effective_cache_size=768MB` in `infra/compose/postgres-start.sh`),
API 1 GiB (Node heap 768 MiB), Caddy 256 MiB; the 4 GiB swapfile absorbs the image build. Every long-running
service restarts unless stopped. The release step installs the CloudWatch agent (memory
and root-disk usage, `infra/compose/cloudwatch-agent.json`) and the stack creates an SNS
topic (`alarmTopicArn`) with an email subscription to `alarmEmail`, which the recipient
must confirm once, and six alarms on the instance: system status check failed for 3 min
(also recovers the instance onto new hardware, keeping volume and address), instance
status check failed for 5 min (also reboots it), CPU above 80% for 15 min, CPU credit
balance below 60, root volume above 80% used, memory above 90% for 10 min. Each alarm
also notifies when it clears. Alarms show INSUFFICIENT_DATA until the first release
starts the agent. No scheduled health probe is deployed; the live canary covers that.

Growth. This shape is meant for one team: expect it to serve a few dozen developers and
tens of gigabytes of traces comfortably. First steps are in place: `instanceType` up to
`t4g.xlarge` (16 GiB; then raise the Compose limits) is an in-place resize with a
stop/start, and `volumeSize` grows the root volume online (Ubuntu extends the filesystem
on the next boot, or run `growpart`/`resize2fs` immediately). Move to a larger shape when
any of these holds: about 50 GB of trace data on disk, several hundred developers or a
sustained ingest that keeps CPU credits low, or a requirement for high availability and
zero-downtime releases. Two paths exist. The Fargate/RDS shape in this program (stacks
`dev`/`prod`) with its dedicated private ClickHouse host: create the stack, restore
PostgreSQL from `pg_dump` of the `agentcommons` database and ClickHouse from a `BACKUP`
of the `ac_trace` database taken on this host, rerun `pnpm db:migrate`, then move DNS; the
application configuration is the same `environment`/`applicationSecrets` values.
ClickHouse Cloud as the trace store instead of a host: the corpus, native users, row
policies and the PostgreSQL-sourced control dictionaries (ADR 0047) all have to exist
there, so the service needs network reachability to PostgreSQL (private endpoint or an
allowlisted address on the control database), the migration has to be rerun against it,
and the isolation properties (row policies, DEFINER views, dictionary freshness) must be
re-verified with the integration suite before any traffic; budget for its minimum monthly
charge and for egress.

Cost, on-demand us-west-2 list prices from the Price List API on 2026-09-09, 730 hours:
`t4g.large` $0.0672/h ($49.06), 60 GiB gp3 $0.08/GiB-month ($4.80), public IPv4
$0.005/h ($3.65), snapshots $0.05/GiB-month (about $1 to $3 for seven incremental
copies), six CloudWatch alarms at $0.10 each ($0.60) and two agent metrics at $0.30 each
($0.60), S3, SNS email and Standard SSM parameters negligible: about **$60 to $62 per
month**. T4g instances launch in `unlimited` credit mode, so CPU sustained above the 30%
per-vCPU baseline is billed at $0.04 per vCPU-hour; the initial image build is a few
cents.
