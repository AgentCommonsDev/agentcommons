# AgentCommons TypeScript SDK

A typed client for the AgentCommons REST API, generated from its OpenAPI contract.
Works in Node.js 20+ and browsers with `fetch`. Each client has its own server URL,
headers and credentials. Requests are not retried automatically.

The package is available from this checkout; it has not been published to npm.

```bash
pnpm install
pnpm --filter @agentcommons/sdk pack --out /tmp/agentcommons-sdk.tgz
# In your application:
npm install /tmp/agentcommons-sdk.tgz
```

```typescript
import { createClient, unwrap } from "@agentcommons/sdk";

const client = createClient({
  baseUrl: "https://your-server.example",
  apiKey: process.env.AGENTCOMMONS_API_KEY,
});

const results = unwrap(
  await client.POST("/api/v1/search", {
    body: { query: "database timeout", limit: 5 },
  }),
);
console.log(results.blocks);

const page = unwrap(
  await client.GET("/api/v1/sessions", {
    params: { query: { filters: { repo_name: "example/project" }, limit: 20 } },
  }),
);
console.log(page.items, page.cursor);
```

Use the server origin as `baseUrl`; endpoint paths already include `/api/v1`.
`paths`, `components`, `operations` and `JsonValue` are exported for application types.
Every documented route is available through `GET`, `POST`, `PATCH`, `PUT` or `DELETE`.
Object filters and array query parameters use the server's encoding automatically.

Without `unwrap`, calls return `{ data, error, response }`. `unwrap` throws `ApiError`
with `status`, `code`, `message`, `position` and `detail`. Network failures retain their
native fetch error. Pagination is explicit: pass the returned cursor into the next
request with the same filters. Optional features still require server configuration;
their presence in the SDK does not enable them.

For a browser session, omit `apiKey` and use `credentials: "include"`. Use API keys in
server code or local scripts; do not embed them in a public web bundle. Cookie-only
operations still require a signed-in user, and admin calls require the corresponding
organization role and key permissions.

Pass `headers`, a custom `fetch`, or other `openapi-fetch` options to `createClient`.
Use a per-call `signal: AbortSignal.timeout(5000)` for a deadline. For CSV exports,
set `format: "csv"` and `parseAs: "text"`. For session events, use `parseAs: "stream"`
and read the returned `ReadableStream`; the SDK does not reconnect or parse SSE frames.

Regenerate with `pnpm sdk:generate:typescript`; verify with `pnpm sdk:check:typescript`.
Generated source is never edited by hand. See [the SDK decision](../../docs/adr/0102-generated-api-sdks.md).
