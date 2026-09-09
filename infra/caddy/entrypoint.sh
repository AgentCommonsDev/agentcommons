#!/bin/sh
# Caddy container entrypoint (docker-compose.caddy.yml). Decides which upstream proxies
# Caddy trusts and which header names the client, exports CADDY_TRUSTED_PROXIES and
# CADDY_CLIENT_IP_HEADER for the Caddyfile, logs the choice, then starts Caddy.
#
# CADDY_TRUSTED_PROXIES selects the mode:
#   empty or "cloudflare"  Cloudflare mode (default). Every start (each release restarts
#                          this container) fetches Cloudflare's published IPv4 and IPv6
#                          ranges; when the fetch fails or returns anything but CIDRs, the
#                          last successfully fetched list in /data is used, and before any
#                          fetch ever succeeded the copy shipped in the repository. The
#                          client address is read from CF-Connecting-IP.
#   "none"                 trust no proxy (DNS-only deployments); forwarded headers from
#                          any client are ignored.
#   anything else          a literal space-separated CIDR list for another proxy; the
#                          client address is read from X-Forwarded-For.
set -eu
cache=/data/cloudflare-ranges.txt
shipped=/etc/caddy/cloudflare-ranges.txt
cidr='^([0-9]{1,3}\.){3}[0-9]{1,3}/[0-9]{1,2}$|^[0-9a-fA-F:]+/[0-9]{1,3}$'
mode=${CADDY_TRUSTED_PROXIES:-cloudflare}
CADDY_CLIENT_IP_HEADER=X-Forwarded-For
case $mode in
cloudflare)
  fetched=$(mktemp)
  if { wget -q -T 15 -O - https://www.cloudflare.com/ips-v4 && echo && wget -q -T 15 -O - https://www.cloudflare.com/ips-v6; } 2>/dev/null |
    tr -d '\r' | grep -v '^$' >"$fetched" &&
    [ "$(grep -cvE "$cidr" "$fetched")" -eq 0 ] && [ "$(wc -l <"$fetched")" -ge 10 ]; then
    mv "$fetched" "$cache"
    echo "caddy entrypoint: Cloudflare mode, trusting $(wc -l <"$cache") ranges fetched now" >&2
  elif [ -s "$cache" ]; then
    rm -f "$fetched"
    echo "caddy entrypoint: Cloudflare mode, fetch failed, trusting $(wc -l <"$cache") ranges from the last fetch" >&2
  else
    rm -f "$fetched"
    cp "$shipped" "$cache"
    echo "caddy entrypoint: Cloudflare mode, fetch failed, trusting $(wc -l <"$cache") ranges shipped with the release" >&2
  fi
  CADDY_TRUSTED_PROXIES=$(tr '\n' ' ' <"$cache" | sed 's/ *$//')
  CADDY_CLIENT_IP_HEADER=CF-Connecting-IP
  ;;
none)
  CADDY_TRUSTED_PROXIES=
  echo "caddy entrypoint: trusting no proxy; forwarded headers are ignored" >&2
  ;;
*)
  echo "caddy entrypoint: trusting the configured proxy ranges: $mode" >&2
  ;;
esac
export CADDY_TRUSTED_PROXIES CADDY_CLIENT_IP_HEADER
exec "$@"
