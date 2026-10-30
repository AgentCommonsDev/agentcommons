import { createPublicKey, verify } from "node:crypto";
import * as z from "zod";

/** `/hook/manifest.json.sig` as `packages/hook/sign.ts` writes it; loose so a later signer can add fields. */
const signatureFileSchema = z.looseObject({
  signatures: z.array(z.string().min(1)).min(1),
});
/** True when one of the file's signatures verifies `manifest` under one of `keys` (ADR 0102). */
export function signedByRelease(
  manifest: Buffer,
  signatureFile: unknown,
  keys: readonly string[],
): boolean {
  const parsed = signatureFileSchema.safeParse(signatureFile);
  if (!parsed.success) return false;
  return keys.some((key) => {
    const publicKey = createPublicKey({
      key: Buffer.from(key, "base64"),
      format: "der",
      type: "spki",
    });
    return parsed.data.signatures.some((signature) =>
      verify(null, manifest, publicKey, Buffer.from(signature, "base64")),
    );
  });
}
