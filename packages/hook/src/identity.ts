import * as z from "zod";
import type { HookConfig } from "./config.js";

export class CredentialRejected extends Error {
  constructor(readonly status: number) {
    super(`The server rejected the credential (HTTP ${String(status)}).`);
  }
}
const identitySchema = z.looseObject({
  organization: z.looseObject({ id: z.string().min(1) }).nullable(),
});
export async function credentialOrganization(
  config: HookConfig,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const response = await fetcher(new URL("/api/v1/me", config.server), {
    headers: { authorization: `Bearer ${config.key}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new CredentialRejected(response.status);
  }
  const identity = identitySchema.parse(await response.json());
  if (!identity.organization)
    throw new Error("The credential does not select an organization.");
  return identity.organization.id;
}
