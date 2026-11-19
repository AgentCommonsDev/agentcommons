# ADR 0103: Clients reach the server over HTTPS only

Date: 2026-10-29
Status: Accepted.

## Context

The shim accepted any `http:` or `https:` server URL, and Caddy's plain `http://` site, which
exists so a new host can be checked by its address before DNS resolves, proxied the whole API.
An installation pointed at `http://<host>` therefore sent its API key on every request, its
transcripts on every upload and its MCP traffic in the clear, and fetched the hook manifest and
bundle over a channel anyone on the path could rewrite. ADR 0102 stops a rewritten manifest from
running code, but the key and the transcripts still leaked.

## Decision

1. **The shim's configuration requires HTTPS.** `configSchema.server` accepts `https:` URLs
   without embedded credentials, and `http:` only for this machine (`localhost`, `127.0.0.0/8`
   in any spelling the URL parser normalizes, `[::1]`), which keeps `pnpm hook:link`, local
   development and the test servers working. `install.sh` fails at `hook.js configure` with
   "plain HTTP is accepted only for localhost".
2. **Caddy's plain-HTTP site carries no API traffic.** `http://` answers `/health` and `/ready`
   from the API, so the host can still be checked by address, and answers every other request
   with a `308` to `PUBLIC_URL`. Requests for the public hostname on port 80 keep Caddy's
   automatic HTTPS redirect.

## Consequences

- An installation configured with a remote `http:` URL stays on the bundle it has: the new
  bundle fails its self-test because `hook.js version` cannot read that configuration (ADR
  0102), and the uploader logs "failed its self-test" every hour. Admin → Installations shows it
  as "Update pending". It needs a reinstall with the `https:` URL; nothing can switch it safely,
  because the only channel to tell it the HTTPS address is the one being distrusted.
- Such an installation keeps working against a Caddy-fronted server meanwhile: its bundle
  follows the `308` to HTTPS, but each request's first hop, key included, still crosses the
  network in the clear until it is reinstalled.
- A self-hosted instance served without TLS on a private network can no longer be used from
  other machines. Put it behind TLS (`docker-compose.caddy.yml`) or reach it through a tunnel to
  `localhost`.
