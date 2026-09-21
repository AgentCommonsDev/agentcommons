import { createAuthClient } from "better-auth/react";
export const authClient = createAuthClient({ basePath: "/auth" });

/** Error code an SSO-only organization returns when a member tries email and password. */
export const SSO_REQUIRED = "SSO_REQUIRED";

/**
 * A Better Auth failure carried as an Error, keeping the server's error code so callers
 * can react to a specific case such as {@link SSO_REQUIRED} instead of a generic message.
 */
export class AuthError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/** Better Auth reports failures in the response; callers want them thrown. */
export function authResult<T>(
  response:
    | { data: T; error: null }
    | {
        data: null;
        error: { message?: string | undefined; code?: string | undefined };
      },
  fallback: string,
): T {
  if (response.error)
    throw new AuthError(
      response.error.message ?? fallback,
      response.error.code,
    );
  return response.data;
}

/** Whether a caught sign-in error is an SSO-only organization refusing a password. */
export function isSsoRequired(error: unknown): boolean {
  return error instanceof AuthError && error.code === SSO_REQUIRED;
}
