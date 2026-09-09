import { createAuthClient } from "better-auth/react";
export const authClient = createAuthClient({ basePath: "/auth" });

/** Better Auth reports failures in the response; callers want them thrown. */
export function authResult<T>(
  response:
    | { data: T; error: null }
    | { data: null; error: { message?: string | undefined } },
  fallback: string,
): T {
  if (response.error) throw new Error(response.error.message ?? fallback);
  return response.data;
}
