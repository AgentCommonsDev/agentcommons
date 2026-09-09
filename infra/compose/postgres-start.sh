#!/bin/sh
# PostgreSQL start script for the single-node Compose override. One place for the
# memory settings of the 1 GiB container; TLS and the restricted pg_hba.conf are enabled
# when the release has provided them (ClickHouse Cloud mode publishes 5432 to the Cloud
# egress addresses only). Hands over to the image's entrypoint so initdb still runs.
set -eu
set -- postgres \
  -c shared_buffers=256MB \
  -c effective_cache_size=768MB \
  -c work_mem=8MB \
  -c maintenance_work_mem=64MB
if [ -s /etc/postgresql/tls/server.key ] && [ -s /etc/postgresql/pg_hba.conf ]; then
  set -- "$@" \
    -c ssl=on \
    -c ssl_cert_file=/etc/postgresql/tls/server.crt \
    -c ssl_key_file=/etc/postgresql/tls/server.key \
    -c ssl_min_protocol_version=TLSv1.2 \
    -c hba_file=/etc/postgresql/pg_hba.conf
  echo "postgres start: TLS on, restricted pg_hba.conf" >&2
else
  echo "postgres start: Compose network only" >&2
fi
exec docker-entrypoint.sh "$@"
