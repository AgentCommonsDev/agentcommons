# AgentCommons Python SDK

Typed synchronous and asynchronous clients for the AgentCommons REST API, generated
from its OpenAPI contract. Requires Python 3.11 or newer.

The package is available from this checkout; it has not been published to PyPI.

```bash
pip install ./packages/sdk-python
```

```python
import os

import httpx
from agentcommons import AuthenticatedClient
from agentcommons.api.default import post_search, get_sessions
from agentcommons.models import PostSearchBody, GetSessionsFilters

with AuthenticatedClient(
    base_url="https://your-server.example",
    token=os.environ["AGENTCOMMONS_API_KEY"],
    timeout=httpx.Timeout(10),
) as client:
    results = post_search.sync(client=client, body=PostSearchBody(query="database timeout"))
    print(results)
    page = get_sessions.sync(
        client=client,
        filters=GetSessionsFilters(repo_name="example/project"),
        limit=20,
    )
    print(page)
```

Use the server origin as `base_url`; endpoint paths already include `/api/v1`.
Endpoint modules follow the OpenAPI operation IDs. Each has `sync`, `sync_detailed`,
`asyncio` and `asyncio_detailed` functions when a response body is documented.
`*_detailed` returns the status, headers, raw content and parsed model.

```python
async with AuthenticatedClient(base_url=server_url, token=api_key) as client:
    results = await post_search.asyncio(client=client, body=PostSearchBody(query="timeout"))
```

HTTP failures raise `agentcommons.ApiError`, an `httpx.HTTPStatusError` with `status`,
`code`, `position`, `detail` and the original response. Connection failures and timeouts
retain their HTTPX exception types. Requests are not retried automatically.

Request and response models support `to_dict()` and `from_dict()`. Optional fields
use `UNSET` from `agentcommons.types`; it means omit the field, while `None` sends JSON
null. UUIDs and timestamps become `UUID` and `datetime` objects; `to_dict()` converts
them back to JSON values. Dynamic JSON values use Python JSON types. Pass a page's cursor into the next
request with the same filters. The SDK does not fetch all pages automatically.

Use `Client` for public endpoints or an existing browser session supplied through
`cookies`. An API key cannot call cookie-only routes. Admin calls require the relevant
organization role and key permissions; optional features require server configuration.
Custom headers and transports can be supplied through `headers` and `httpx_args`.

For CSV, pass `format_="csv"` to a `*_detailed` call and read its `content`; `parsed`
is `None`. For large downloads and session events, use the client's HTTPX streaming
interface so the response is not buffered:

```python
with client.get_httpx_client().stream(
    "GET", f"/api/v1/sessions/{session_id}/events"
) as response:
    response.raise_for_status()
    for line in response.iter_lines():
        print(line)
```

Streaming uses HTTPX's native error handling and yields SSE lines without decoding or
reconnection. Use this inside the client's context manager. Its async equivalent is
`client.get_async_httpx_client().stream(...)` with `aiter_lines()`.

Development uses [uv](https://docs.astral.sh/uv/):

```bash
uv sync --project packages/sdk-python --locked
pnpm sdk:generate:python
pnpm sdk:check:python
pnpm test:sdk:python
uv build --project packages/sdk-python
```

The pinned generator owns `api/`, `models/`, `client.py`, `errors.py`, `types.py` and
`py.typed`. Generation fails on warnings, omitted endpoints or a changed template.
See [the SDK decision](../../docs/adr/0102-generated-api-sdks.md) for schema adaptations.
