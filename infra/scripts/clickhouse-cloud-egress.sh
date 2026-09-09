#!/usr/bin/env bash
# Refreshes infra/compose/clickhouse-cloud-egress.json from ClickHouse Cloud's published
# static addresses. The single-node stack opens PostgreSQL 5432 to exactly these
# addresses (security group and pg_hba.conf), so rerun this, review the diff, then
# `pulumi up` and release when ClickHouse announces new egress addresses.
set -euo pipefail
repo=$(cd "$(dirname "$0")/../.." && pwd)
target="$repo/infra/compose/clickhouse-cloud-egress.json"
curl -fsS --max-time 30 https://api.clickhouse.cloud/static-ips.json |
  jq --arg fetched "$(date -u +%Y-%m-%d)" '{
    source: "https://api.clickhouse.cloud/static-ips.json",
    fetched: $fetched,
    egress: (to_entries | map({key: .key, value: (.value | map({key: .region, value: (.egress_ips | sort)}) | from_entries)}) | from_entries)
  }' >"$target.new"
jq -e '.egress.aws["us-west-2"] | length >= 1' "$target.new" >/dev/null
mv "$target.new" "$target"
(cd "$repo" && pnpm exec prettier --write "$target" >/dev/null)
echo "Wrote $target ($(jq -r '[.egress[] | length] | add' "$target") regions)"
