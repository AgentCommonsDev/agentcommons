#!/usr/bin/env bash
# Runs on the host as root (invoked by /usr/local/bin/agentcommons-release). Converges the
# unpacked source in /opt/agentcommons/app: renders .env from the stack's SSM SecureString
# parameters, builds the image, runs the migration task and restarts the API behind
# Caddy. Idempotent; the full build log stays on the host under /var/log/agentcommons.
set -euo pipefail
: "${AWS_REGION:?Set AWS_REGION}" "${AGENTCOMMONS_PARAMETER_PATH:?Set AGENTCOMMONS_PARAMETER_PATH}"
app=${AGENTCOMMONS_APP_DIR:-/opt/agentcommons/app}
logs=/var/log/agentcommons
install -d -m 0750 "$logs"
log="$logs/apply-$(date -u +%Y%m%dT%H%M%SZ).log"
cd "$app"
setting() {
  sed -n "s/^$1='\(.*\)'\$/\1/p" .env
}
compose() {
  docker compose -p agentcommons -f docker-compose.yml -f docker-compose.caddy.yml "${compose_files[@]}" "$@"
}

umask 077
# Values are single-quoted so Compose reads them literally; the stack refuses quotes.
aws ssm get-parameters-by-path --region "$AWS_REGION" --path "$AGENTCOMMONS_PARAMETER_PATH" \
  --recursive --with-decryption --output json |
  jq -r '.Parameters[] | (.Name | split("/") | last) as $key | .Value as $value
    | if ($value | test("[\u0027\r\n]")) then error("Parameter \($key) contains a quote or line break")
      else "\($key)=\u0027\($value)\u0027" end' >.env.new
[ -s .env.new ] || {
  echo "No parameters found under $AGENTCOMMONS_PARAMETER_PATH" >&2
  exit 1
}
mv .env.new .env
echo "Rendered $(wc -l <.env) settings into $app/.env"

compose_files=()
if [ "$(setting TRACE_STORE)" = clickhouse-cloud ]; then
  # ClickHouse Cloud reads the control tables and dictionaries from this PostgreSQL over
  # TLS. The certificate names the public address (SAN) so Cloud verifies it with
  # sslmode=verify-full; pg_hba.conf admits only ac_trace_control from Cloud's egress
  # addresses (the same list the security group uses) plus the Compose network.
  compose_files=(-f docker-compose.clickhouse-cloud.yml)
  tls=/opt/agentcommons/postgres-tls
  host=$(setting CLICKHOUSE_POSTGRES_HOST)
  install -d -m 0755 "$tls"
  if [ ! -s "$tls/server.key" ] || ! openssl x509 -in "$tls/server.crt" -noout -ext subjectAltName 2>/dev/null | grep -q "IP Address:$host"; then
    openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=$host" \
      -addext "subjectAltName=IP:$host,DNS:db" -keyout "$tls/server.key.new" -out "$tls/server.crt.new" 2>>"$log"
    mv "$tls/server.key.new" "$tls/server.key"
    mv "$tls/server.crt.new" "$tls/server.crt"
    echo "Issued a PostgreSQL server certificate for $host"
  fi
  chown 999:999 "$tls/server.key"
  chmod 0600 "$tls/server.key"
  chmod 0644 "$tls/server.crt"
  cloud_host=$(setting CLICKHOUSE_URL | sed -E 's#^https?://([^/:]+).*#\1#')
  provider=$(cut -d. -f3 <<<"$cloud_host")
  region=$(cut -d. -f2 <<<"$cloud_host")
  {
    echo "# Rendered by infra/scripts/single-node/apply.sh for ClickHouse Cloud $provider/$region; do not edit."
    echo "local   all          all                              trust"
    for network in 127.0.0.1/32 ::1/128 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16; do
      echo "host    all          all              $network scram-sha-256"
    done
    jq -er --arg p "$provider" --arg r "$region" '.egress[$p][$r][]' infra/compose/clickhouse-cloud-egress.json |
      while read -r address; do
        echo "hostssl agentcommons ac_trace_control $address/32 scram-sha-256"
      done
  } >"$tls/pg_hba.conf.new"
  grep -q '^hostssl' "$tls/pg_hba.conf.new" || {
    echo "No ClickHouse Cloud egress addresses for $provider/$region in infra/compose/clickhouse-cloud-egress.json" >&2
    exit 1
  }
  mv "$tls/pg_hba.conf.new" "$tls/pg_hba.conf"
  chmod 0644 "$tls/pg_hba.conf"
  echo "PostgreSQL admits ac_trace_control over TLS from $(grep -c '^hostssl' "$tls/pg_hba.conf") ClickHouse Cloud addresses"
fi

echo "Building the image and starting services (log: $log)"
if ! compose up -d --build --remove-orphans >"$log" 2>&1; then
  tail -n 80 "$log" >&2
  echo "Compose failed; see $log" >&2
  exit 1
fi
for _ in $(seq 1 60); do
  curl -fsS http://127.0.0.1:3000/ready >/dev/null 2>&1 && break
  sleep 5
done
curl -fsS http://127.0.0.1:3000/ready >/dev/null || {
  compose ps >&2
  compose logs --tail 50 api >&2
  echo "The API did not become ready." >&2
  exit 1
}
if [ "$(setting TRACE_STORE)" = clickhouse-cloud ]; then
  # The control dictionary is direct: one lookup proves Cloud reaches PostgreSQL over TLS.
  lookup=$(curl -fsS --max-time 30 -H "X-ClickHouse-User: $(setting CLICKHOUSE_MIGRATION_USER)" \
    -H "X-ClickHouse-Key: $(setting CLICKHOUSE_MIGRATION_PASSWORD)" "$(setting CLICKHOUSE_URL)/" \
    --data-binary "SELECT dictGet('$(setting CLICKHOUSE_DATABASE).session_scope','purged',('probe',toUUID('00000000-0000-0000-0000-000000000000'))) FORMAT TSV") || {
    echo "ClickHouse Cloud could not read the PostgreSQL control dictionary." >&2
    exit 1
  }
  echo "ClickHouse Cloud reads the PostgreSQL control dictionary (probe returned $lookup)"
fi
# Caddy refreshes its trusted Cloudflare ranges at start, so every release restarts it.
compose restart caddy >>"$log" 2>&1
# Host metrics (memory, root disk) for the stack's CloudWatch alarms; idempotent.
if ! dpkg -s amazon-cloudwatch-agent >/dev/null 2>&1; then
  curl -fsSL https://amazoncloudwatch-agent.s3.amazonaws.com/ubuntu/arm64/latest/amazon-cloudwatch-agent.deb -o /tmp/amazon-cloudwatch-agent.deb
  dpkg -i /tmp/amazon-cloudwatch-agent.deb >>"$log" 2>&1
  rm -f /tmp/amazon-cloudwatch-agent.deb
fi
/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -s \
  -c "file:$app/infra/compose/cloudwatch-agent.json" >>"$log" 2>&1
docker image prune -f >/dev/null
compose ps
echo "AgentCommons is ready at $(sed -n "s/^PUBLIC_URL='\(.*\)'$/\1/p" .env)"
