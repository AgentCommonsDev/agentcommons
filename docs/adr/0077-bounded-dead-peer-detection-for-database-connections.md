# ADR 0077: Containers that talk to PostgreSQL detect a dead peer within a minute

Date: 2026-09-12
Status: Accepted. Extends ADR 0047 (control reads through ClickHouse's PostgreSQL engine),
ADR 0055 (single-node shape) and ADR 0063 (control database outside the host).

## Context

On 2026-09-12 at 06:12 UTC Ubuntu's unattended upgrade installed `libc6` and `systemd` on
the hosted single-node instance and restarted `systemd-networkd`, `systemd-resolved` and
`containerd` under the running stack. Aurora saw the stack's connections close within
minutes (29 to 5 on the cluster's `DatabaseConnections`); the sixteen pooled connections
ClickHouse's PostgreSQL engine holds to the control tables never learned, because nothing
was sent on them until 06:52.

At 06:52 the first dashboard render, two `sql` calls and a session list sent `COPY` on
those dead connections. Each blocked in the socket until the kernel gave up
retransmitting: with `net.ipv4.tcp_retries2=15` that is about sixteen minutes (ClickHouse
recorded `TIMEOUT_EXCEEDED` with `elapsed 957395 ms, maximum 5000 ms`). ClickHouse enforces
`max_execution_time` only between blocks, so the reader limit of 5 s never fired. Thirteen
stuck queries held thirteen of the pool's sixteen connections; the 07:00 pre-render added
more and the pool, then the server's 32 query slots, were exhausted
(`POSTGRESQL_CONNECTION_FAILURE` 20, `TOO_MANY_SIMULTANEOUS_QUERIES` 13). Every read of the
organization failed until 07:16, and again from 08:00 to 08:16 after the next pre-render.
The API's own pool recovered at once because its client reconnects on the first failed
write; the outage was entirely the silent half-open connections inside ClickHouse.

The kernel defaults inside every container are the host's: keepalive after 7200 s idle,
75 s between probes, 9 probes, and 15 retransmissions (about 924 s) before an in-flight
segment is abandoned. ClickHouse's PostgreSQL engine exposes a connect timeout
(`postgresql_connection_attempt_timeout`) but no read timeout and no way to pass libpq
keepalive or `tcp_user_timeout` parameters; libpq enables `SO_KEEPALIVE` with the system
values.

## Decision

`docker-compose.yml` sets, on `clickhouse` and on the application anchor shared by `api`
and `migrate`:

```
net.ipv4.tcp_keepalive_time=30   # first probe after 30 s idle
net.ipv4.tcp_keepalive_intvl=10  # then every 10 s
net.ipv4.tcp_keepalive_probes=3  # dead after 3 unanswered probes: about 60 s idle
net.ipv4.tcp_retries2=6          # in-flight data abandoned after about 13 to 25 s
```

These are per-network-namespace sysctls (Linux 4.6 and later), so Compose applies them to
the container without touching the host, and they survive the Caddy and external-database
overrides. A dead pooled connection now fails within about a minute of going idle and a
blocked control read within about fifteen seconds, so a network event under the stack costs
one short burst of `503 READ_TIME_LIMIT`/`OPERATION_FAILED` answers instead of a sixteen
minute read outage.

## Consequences

- Retransmission gives up after roughly fifteen seconds inside the VPC. A path that is
  genuinely unreachable for longer than that fails the statement, which is the right answer
  behind a 5 s reader budget; the ClickHouse pool retries a fresh connection on the next
  query (`postgresql_connection_pool_retries=2`).
- Keepalive traffic is sixteen probes per 30 s at most from ClickHouse's pool, nothing
  measurable on Aurora.
- The API's Node clients enable keepalive themselves where they do (`tokio-postgres` sets
  its own idle interval); the `tcp_retries2` bound still protects their in-flight statements.
- The trigger is unchanged: unattended upgrades still restart host services. Operators may
  set `needrestart` to list-only or pin the upgrade window; that is host policy, recorded in
  the runbook, not in this decision.
- ADR 0047's model (ClickHouse reads control state from PostgreSQL per query) keeps the
  property that a control-plane stall is a read stall; this decision bounds that stall.
