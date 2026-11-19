import { createPrivateKey, sign } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

/**
 * Signs the hook manifest `build.ts` wrote (ADR 0102): an Ed25519 signature over the exact
 * bytes of the manifest, written beside it as `<manifest>.sig`, which installed shims check
 * against the keys pinned in their bundle before they act on an update.
 *
 *   node packages/hook/sign.ts <key file> <manifest.json>
 *
 * The key file holds the PKCS#8 DER private key in base64 (`openssl genpkey -algorithm
 * ed25519 -outform DER | base64`). The release image build runs this with Node alone, in
 * its own step with only the key mounted, so no package manager or build tool sees the key;
 * it therefore imports nothing but Node built-ins.
 */
const [keyFile, manifestFile] = process.argv.slice(2);
if (!keyFile || !manifestFile)
  throw new Error(
    "Usage: node packages/hook/sign.ts <key file> <manifest.json>",
  );
const encoded = readFileSync(keyFile, "utf8").trim();
if (!encoded) throw new Error("The hook signing key file is empty.");
const key = createPrivateKey({
  key: Buffer.from(encoded, "base64"),
  format: "der",
  type: "pkcs8",
});
if (key.asymmetricKeyType !== "ed25519")
  throw new Error("The hook signing key must be an Ed25519 key.");
const manifest = readFileSync(manifestFile);
// The client's forward-only guard compares this stamp (ADR 0075); a signed manifest without
// it would let a server replay an older signed release.
const stamp = (JSON.parse(manifest.toString("utf8")) as { builtAt?: unknown })
  .builtAt;
if (typeof stamp !== "string")
  throw new Error(
    "The hook manifest carries no builtAt stamp; build it with AGENTCOMMONS_CREATED or from a git checkout.",
  );
writeFileSync(
  `${manifestFile}.sig`,
  JSON.stringify({
    signatures: [sign(null, manifest, key).toString("base64")],
  }),
);
