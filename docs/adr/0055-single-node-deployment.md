# ADR 0055: A single-node deployment shape in the same Pulumi program

Date: 2026-09-09
Status: Accepted. Complements the Fargate/RDS stacks of §13; it does not replace them.

## Context

The first customer instance (Goodhart Labs, `hooks.tools.goodhartlabs.com`) needs a
self-hosted AgentCommons that is cheap, reachable at one fixed IP address the customer
can point DNS at, and operable by one person. The Fargate plan costs about $185 per month
in production and about $92 in the dev shape before traffic, most of it NAT gateways,
the load balancer and RDS, and it publishes a load-balancer hostname rather than an
address. ADR 0019 defers cloud deployment to operator approval; the operator has now
asked for this deployment.

## Decision

The Pulumi program gains a second shape selected by stack config `deployment:
single-node`. The program's default export returns the outputs of the selected shape;
the Fargate program is unchanged and remains the default. The single-node shape creates,
in the default VPC's public subnet: a security group admitting only 80 and 443; one arm64
Ubuntu 24.04 `t4g.large` with a 60 GiB encrypted gp3 root volume, IMDSv2 required and no
SSH (management through SSM Session Manager); an Elastic IP; an instance role limited to
SSM, one private release bucket and the stack's SSM parameters; and a Data Lifecycle
Manager policy keeping seven daily snapshots.

The host runs the repository's `docker-compose.yml` plus `docker-compose.caddy.yml`.
Caddy terminates TLS for `PUBLIC_URL` with automatic certificates and also answers plain
HTTP on the bare address; the API trusts forwarded headers from the Compose network
(`TRUST_PROXY=uniquelocal`). Configuration is Pulumi config rendered into SSM
SecureString parameters under `/agentcommons/<stack>/env/`, one per `.env` key, so
Pulumi stays the source of truth and the host reads them at release time. Releases are
`git archive` tarballs of a commit in the private bucket; `single-node-release.sh`
uploads one and runs the on-host apply through SSM Run Command, which rebuilds the image,
runs both database migrations and restarts the API. `single-node-run.sh bootstrap.sh` seeds the
owner organization and enrolls Google sign-in domains (ADR 0049) by completing the
owner's setup link with a generated password through Better Auth's native endpoints and
handing that session cookie to the existing `db:domain` CLI; the link and password stay
in a root-only file on the host. State lives in a private S3 bucket with the passphrase
secrets provider.

## Consequences

- Cost is about $60 to $62 per month at us-west-2 list prices, alarms included.
- There is no redundancy: recovery is a snapshot restore. The instance is protected in
  Pulumi and ignores image and first-boot changes so a routine `pulumi up` cannot
  replace the volume that holds PostgreSQL, ClickHouse and Caddy state.
- Building the image on the host takes ten to fifteen minutes and uses a swapfile; a
  registry-based image path can be added later without changing the shape.
- The owner account gets a generated password in addition to Google sign-in. This is
  the only way to obtain an owner session non-interactively without custom identity
  code, which the rules forbid; `db:recover` rotates it.
- No SSH, no public database ports, no secrets in user data or in SSM command output.
- The trace store is selectable: the local ClickHouse container (default) or a ClickHouse
  Cloud service (`traceStore: clickhouse-cloud`, chosen for zpghl). In Cloud mode the same
  migration creates users, roles, row policies, dictionaries and views on Cloud, and
  PostgreSQL is published on 5432 with TLS to exactly ClickHouse Cloud's egress addresses
  (security group and `hostssl`-only `pg_hba.conf` from a reviewed snapshot) so the
  PostgreSQL-sourced control dictionaries keep working; certificate verification of
  the host (`sslmode=verify-full`) is opt-in because the current Cloud release rejects
  libpq options. Cloud is billed separately by ClickHouse.
- Compose memory limits (ClickHouse 3.5 GiB, PostgreSQL 1 GiB, API 1 GiB, Caddy 256 MiB)
  keep one service from starving the others; six CloudWatch alarms (status checks with
  recover/reboot actions, CPU, CPU credits, disk, memory) notify an SNS email subscription.
  Growth beyond one team moves to the Fargate/RDS shape or ClickHouse Cloud as documented
  in `infra/OPERATIONS.md`.
- Cloudflare's proxy is the default mode: Caddy's entrypoint fetches Cloudflare's
  published ranges at every start (falling back to the last fetched list, then to a copy
  shipped with the release, and logging which it used), trusts them as proxies, reads the
  client from `CF-Connecting-IP` and rewrites `X-Forwarded-For` to that address, so the
  API trusts only Caddy. `CADDY_TRUSTED_PROXIES=none` trusts no proxy for DNS-only records;
  a literal CIDR list serves another proxy. Certificates stay Let's Encrypt HTTP-01 through
  the proxy; the zone must use SSL mode Full (strict) and keep "Always Use HTTPS" off.
  Cloudflare's 100 s idle limit turns a quiet live stream into a reconnect with polling in
  between; uploads and API bodies stay far below its 100 MB body limit.
