import * as z from "zod";
import type { HookConfig } from "./config.js";

/** Statuses the server answers only after it resolved the credential (§9.2). */
const REJECTION_STATUSES: readonly number[] = [401, 403];
const errorBodySchema = z.looseObject({ code: z.string().min(1) });
const identitySchema = z.looseObject({
  organization: z.looseObject({ id: z.string().min(1) }).nullable(),
});

export class CredentialRejected extends Error {
  constructor(
    readonly status: number,
    /** The server's error code, or null when the body was not the API error shape. */
    readonly code: string | null,
  ) {
    super(
      REJECTION_STATUSES.includes(status)
        ? `The server rejected the credential (HTTP ${String(status)}${code ? `, ${code}` : ""}).`
        : `The server could not verify the credential (HTTP ${String(status)}). Try again.`,
    );
  }
}
/** The stable code an API error response carries; null for a proxy page, an empty body or other non-API answers. */
export async function rejectionCode(
  response: Response,
): Promise<string | null> {
  try {
    return errorBodySchema.parse(await response.json()).code;
  } catch {
    return null;
  }
}
/**
 * Confirms a 401/403 with a second request, `GET /api/v1/me` under the same credential
 * (§6.2 upload step 3). A 401 is confirmed when the server rejects the credential again;
 * a 403 is confirmed when the server answers the credential at all (200 or 401/403),
 * because it reaches a 403 only after resolving the key. A 5xx, 429, network failure or
 * timeout leaves the rejection unconfirmed and the session retryable.
 */
export async function rejectionConfirmed(
  config: HookConfig,
  status: number,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetcher(new URL("/api/v1/me", config.server), {
      headers: { authorization: `Bearer ${config.key}` },
      signal: AbortSignal.timeout(10000),
    });
    await response.body?.cancel();
    return (
      REJECTION_STATUSES.includes(response.status) ||
      (status === 403 && response.ok)
    );
  } catch {
    return false;
  }
}
export async function credentialOrganization(
  config: HookConfig,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const response = await fetcher(new URL("/api/v1/me", config.server), {
    headers: { authorization: `Bearer ${config.key}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    if (REJECTION_STATUSES.includes(response.status))
      throw new CredentialRejected(
        response.status,
        await rejectionCode(response),
      );
    await response.body?.cancel();
    throw new CredentialRejected(response.status, null);
  }
  const identity = identitySchema.parse(await response.json());
  if (!identity.organization)
    throw new Error("The credential does not select an organization.");
  return identity.organization.id;
}
