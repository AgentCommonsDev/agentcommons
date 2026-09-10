# ADR 0063: The control database may run on Aurora PostgreSQL outside the host

Date: 2026-09-10
Status: Accepted. Extends ADR 0055 (single-node shape) and the self-host Compose stack; the
bundled PostgreSQL container stays the default for both.

## Context

The single-node deployment (ADR 0055) runs PostgreSQL, ClickHouse, the API and Caddy on one
`t4g.large` with two vCPUs. In the 2026-09-10 census on the hosted instance the PostgreSQL
container ran at 115 to 168% CPU during a controlled load test: every ClickHouse row policy
called the PostgreSQL-sourced control dictionary once per scanned block, and each call was
a `COPY` against the control views. ADR 0062 removes the per-row form, but the control
plane still competes with ClickHouse and Node for the same two cores, its only replica is a
daily EBS snapshot of the whole host, and a larger instance buys more of everything rather
than more database.

The owner asked for the option to run the control plane on Amazon Aurora PostgreSQL,
"not massive but decent", as a documented option of the single-node deployment and of the
self-host Compose stack rather than a one-off for one customer. The cutover on the hosted
instance waits for the pending performance release.

## Decision

1. **A `database` stack setting on the single-node shape.** `{ kind: bundled }` (the
   default) keeps today's container. `{ kind: aurora-serverless-v2, minCapacity: 0.5,
maxCapacity: 4, engineVersion: "16", forceSsl: true }` provisions, in the host's VPC
   (`infra/aurora.ts`): an Aurora PostgreSQL cluster (engine mode `provisioned` with a
   Serverless v2 scaling range, PostgreSQL 16 to match the container, encrypted, seven
   days of backups, deletion protection, a final snapshot, `applyImmediately: false`,
   PostgreSQL logs to CloudWatch, Pulumi protection), one `db.serverless` writer placed in
   the host's availability zone, a subnet group over the host's subnets, a security group
   admitting 5432 only from the host's security group, a cluster parameter group pinning
   `rds.force_ssl`, and four alarms (CPU, ACU utilization, freeable memory, connections)
   on the stack's existing alert topic. The master user is `agentcommons` with the
   `databaseMigrationPassword` secret, the same name and credential the bundled container
   uses for `POSTGRES_USER`, so `pnpm db:migrate`, the dump and the restore see one
   identity in both shapes. `manageMasterUserPassword` is not used: the host reads its
   whole `.env` from the stack's SSM parameters, so a Secrets Manager credential would add
   a second secret path, an IAM grant and a rotation the migration URLs cannot follow; the
   password already lives encrypted in the Pulumi state and in SSM.
2. **The rendered `.env` moves with it.** `DATABASE_MIGRATION_URL`, `DATABASE_URL` and
   `DATABASE_TRACE_CONTROL_URL` point at the cluster endpoint with
   `?sslmode=require&uselibpqcompat=true`; `CLICKHOUSE_POSTGRES_HOST` is the endpoint;
   `AGENTCOMMONS_DATABASE=external` replaces `bundled`. One query string serves three
   clients: Prisma and ClickHouse (libpq) read `sslmode=require` as "encrypt, do not
   verify", while node-postgres (pg-boss and the migration's role grants) would verify the
   Amazon RDS certificate against Node's CA store and fail, unless `uselibpqcompat=true`
   tells it to follow libpq. libpq itself rejects the unknown flag, so the runbook strips
   it before `psql`, `pg_dump` and `pg_restore`. Certificate verification (`verify-full`
   with the RDS trust bundle in the image, in three parameter dialects) is deferred; the
   link is encrypted and reachable only from the host's security group.
3. **Compose learns one variable.** `AGENTCOMMONS_DATABASE=bundled|external` in `.env`
   selects `docker-compose.external-database.yml`, which parks the `db` service behind a
   profile (its volume stays for a rollback) and drops the migration's dependency on it
   with `!reset`, exactly as `TRACE_STORE` selects the ClickHouse Cloud file. The
   single-node apply derives `COMPOSE_FILE` from both settings; a plain Compose install
   sets `COMPOSE_FILE` and the URLs itself. Nothing in the stack reads `if external`
   beyond that file selection and the post-release dictionary probe.
4. **Bootstrap is unchanged.** `pnpm db:migrate` creates the roles, schemas, grants and
   pg-boss schema as the connecting owner; Aurora's master user is not a superuser but has
   CREATEROLE and owns the database, which is all the migrations need. A test proves this
   against a PostgreSQL 16 that enforces TLS and is owned by a non-superuser, and that
   ClickHouse 26.8 creates and reads the `PostgreSQL` engine tables and direct
   dictionaries over TLS with the rendered URL. If a ClickHouse release cannot negotiate
   TLS, `forceSsl: false` sets `rds.force_ssl=0` in the parameter group as the fallback.
5. **Cutover is a shipped script with a rollback.** `scripts/self-host/migrate-database.sh`
   copies roles (rebuilt from `pg_roles`, which needs no superuser, without passwords:
   `db:migrate` sets them from the URLs before the API starts) and data (`pg_dump -Fc`, `pg_restore --no-owner --role=<master> --single-transaction
--exit-on-error`) from one PostgreSQL to another through the `postgres:16` image and
   compares per-table row counts; `infra/scripts/single-node/migrate-database.sh` renders
   the stack's new parameters beside the running `.env`, stops the API, copies, swaps
   `.env`, restarts (the migration re-points ClickHouse's control tables and dictionaries),
   probes a dictionary read and a session list, and `--rollback` restores the bundled
   `.env` and container.
6. **ClickHouse Cloud and Aurora do not combine.** Cloud reads PostgreSQL at the host's
   public address; the cluster is private to the VPC. The settings schema refuses the pair.

## Consequences

- Cost (us-west-2 on-demand list prices from the Price List API, 2026-09-10, 730 h):
  Serverless v2 $0.12 per ACU-hour, storage $0.10 per GB-month, I/O $0.20 per million
  requests, backups free up to the cluster's size, four alarms $0.40. Idle at 0.5 ACU:
  about $46 per month; averaging 2 ACU: about $178. A second `db.serverless` instance in
  another zone (reader with automatic failover, the HA upgrade) adds the same ACU charge
  again: $43.80 at 0.5 ACU, $175.20 at 2 ACU. The host itself is unchanged.
- The control plane leaves the host's CPU and memory; the 1 GiB Compose limit for
  PostgreSQL is no longer used and the parked container holds no memory.
- Every control read is a network hop instead of a local socket: sub-millisecond within
  the availability zone, which is why the writer is placed in the host's zone whenever the
  cluster's zones include it (a new cluster lists the host's zone first; RDS adds two more). This was
  not measured before the cutover; measure it with the census queries afterwards.
- TLS is encrypted but unverified (`sslmode=require`), the same posture the ClickHouse
  Cloud mode has today. `forceSsl: false` exists only as a fallback and weakens that.
- Backups: Aurora keeps seven days of continuous backups plus the final snapshot;
  the host's daily EBS snapshots no longer contain PostgreSQL data once the volume is
  removed. Until then the parked `db` volume is a point-in-time copy from the cutover.
- Two shapes share one bootstrap, one migration and one `.env` contract; a plain Compose
  install gains the same option with any managed PostgreSQL 16 that speaks TLS.
- The Fargate shape still renders `sslmode=require` alone, which node-postgres treats as
  verify-against-Node's-store; it inherits this ADR's suffix in a follow-up.
