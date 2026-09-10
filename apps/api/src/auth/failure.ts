import { APIError } from "better-auth/api";
import { ServiceError } from "../services/context.js";

/** Seconds a client waits before retrying a credential check the server could not complete. */
const AUTH_RETRY_AFTER_SECONDS = 5;

/**
 * The 503 every adapter returns when a credential could not be verified (§9.2): a
 * database error, statement or lock timeout, pool exhaustion, or a Better Auth failure
 * that is not an explicit verdict. It carries the retryable `retry_after` detail that
 * 429 and `AUDIT_UNAVAILABLE` use, and its cause for the request log; it is never a
 * rejection, so the shim keeps the session and retries (§6.2).
 */
export function authUnavailableError(cause: unknown): ServiceError {
  const failure = new ServiceError(
    503,
    "AUTH_UNAVAILABLE",
    "The credential could not be verified right now. Retry the request.",
    { retry_after: AUTH_RETRY_AFTER_SECONDS },
  );
  failure.cause = cause;
  return failure;
}

/**
 * Classifies a failure of identity resolution for every adapter (REST, MCP, SSE, native
 * forwarders). A credential is rejected with 401/403 only when the lookup completed:
 * the identity code threw its own `ServiceError`, or Better Auth answered with an explicit
 * 401/403 verdict. Anything else could not be verified and is `AUTH_UNAVAILABLE`.
 */
export function authenticationFailure(error: unknown): ServiceError {
  if (error instanceof ServiceError) return error;
  if (error instanceof APIError && [401, 403].includes(error.statusCode))
    return new ServiceError(
      error.statusCode,
      "INVALID_AUTHENTICATION",
      "Sign in or provide a valid organization API key.",
    );
  return authUnavailableError(error);
}
