# ADR 0102: Generate TypeScript and Python clients from OpenAPI

Status: accepted

## Context

The dashboard already uses `openapi-typescript` and `openapi-fetch`, but its client
depends on browser credentials, dashboard copy and a private core type. External
applications need installable TypeScript and Python libraries without copying routes
or maintaining separate endpoint definitions.

## Decision

Extract the TypeScript client to `packages/sdk` (`@agentcommons/sdk`) and have the
dashboard consume it. Generate Python models and synchronous/asynchronous operations
with pinned `openapi-python-client` in `packages/sdk-python` (`agentcommons`). Both
consume the same checked-in OpenAPI artifact, including optional feature groups, and
have no dependency on private workspace packages. Public registries are not published
as part of this change.

Keep transport conventions in a small shared runtime per language: JSON object query
values, bracketed arrays, caller-supplied authentication and structured HTTP errors.
There are no per-route wrappers, retries, automatic pagination or new server services.
Use native fetch/HTTPX streaming for SSE and large downloads. The dashboard retains
its UI fallback message and uses the package's client and error implementation.

The Python generator does not support our recursive JSON union or OpenAPI 3.1 tuple
syntax, and repeated anonymous union objects cause naming collisions. Prepare an
equivalent input without changing the API artifact: unrestricted JSON leaves replace
recursive JSON refs, homogeneous closed tuples become arrays with the same length
bounds, and component union objects receive named refs. Fail for unsupported tuple
shapes rather than widening them. Dynamic JSON leaves are `Any` in Python; surrounding
models remain typed. The TypeScript client keeps its recursive `JsonValue` type.

Small checked overlays on the pinned generator templates preserve named object query
parameters, apply the shared HTTP error handler and leave CSV content unparsed.
Generation fails on warnings, missing operations, changed templates or schema-name
collisions. A version upgrade therefore requires reviewing generated changes.

## Verification

CI compares regeneration with tracked output, checks typed TypeScript calls and runtime
encoding/authentication/errors, exercises Python sync and async calls, and installs
the built npm tarball and wheel into clean temporary consumers. API integration tests
exercise both clients against real PostgreSQL/ClickHouse services. README changes
preserve existing information and do not alter captured UI screens.
