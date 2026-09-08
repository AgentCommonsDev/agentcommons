# 0040. Render the generated API reference with Scalar

Status: accepted.

The API reference must be useful for inspecting operations and their input/output schemas.
The requested Scalar interface replaces Swagger UI at `/api/docs`. The underlying
`@fastify/swagger` generator remains: application routes declare shared Zod schemas,
which generate both the published OpenAPI artifact and the live document. No parallel
handwritten OpenAPI source is introduced.

Use the official `@scalar/fastify-api-reference` integration and its locally served
browser bundle. `/api/docs/json` remains the stable live specification endpoint, including
feature-flag-dependent routes. Documentation remains public and contains static capability
contracts, never tenant records. Its reserved namespace retains the existing exception
from application route-schema enforcement because the native plugin owns its assets.
Normal API authentication and service authorization still apply when a reader tries an
operation. The reference must work under an explicit Content Security Policy, without an
external API proxy or a CDN dependency. Browser tests verify rendered operation search,
request/response schemas, local assets, and security headers against the live generated
specification.

The integration follows [Scalar's official Fastify guide](https://scalar.com/products/api-references/integrations/fastify).

The first real browser run found that Scalar's default AI agent tried to contact its
public registry even with telemetry disabled. The native `agent.disabled` and
`mcp.disabled` settings turn off those unrelated hosted integrations; telemetry,
credential persistence, default remote fonts and the request proxy are also disabled.

Scalar bundles Zod, whose optional eval capability probe is caught by CSP but emits a
browser violation. A small local browser prelude calls the official Zod `config` API
with `jitless: true` before Scalar loads; bundled Zod instances share that configuration.
The API build and development commands build this prelude with esbuild. No minified
vendor code or private global is patched. Fastify stamps the native HTML scripts with
a fresh response nonce through the same shared helper as the dashboard. The policy
allows local scripts and connections, with no `unsafe-eval` or external script origin.
