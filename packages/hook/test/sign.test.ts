import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { signedByRelease } from "../src/signature.js";

const script = resolve(import.meta.dirname, "../sign.ts");
const manifest = JSON.stringify({
  version: "0.1.0-test",
  sha256: "a".repeat(64),
  url: "/hook/0.1.0-test/hook.js",
  extensionSha256: "b".repeat(64),
  extensionUrl: "/hook/0.1.0-test/pi-extension.mjs",
  builtAt: "2026-10-29T00:00:00.000Z",
  revision: "f".repeat(40),
});
function release(manifestText: string, keyText: string) {
  const directory = mkdtempSync(join(tmpdir(), "agentcommons-sign-"));
  const manifestFile = join(directory, "manifest.json");
  const keyFile = join(directory, "key");
  writeFileSync(manifestFile, manifestText);
  writeFileSync(keyFile, keyText, { mode: 0o600 });
  // As the release image build runs it: Node alone, no package manager or loader.
  const result = spawnSync(process.execPath, [script, keyFile, manifestFile], {
    encoding: "utf8",
  });
  return { result, manifestFile };
}
const pkcs8 = (key: ReturnType<typeof generateKeyPairSync>["privateKey"]) =>
  key.export({ format: "der", type: "pkcs8" }).toString("base64");

describe("the release signing step", () => {
  // @req R-CAP-30
  it("signs the manifest's exact bytes so a shim pinning the public key accepts it and one pinning another refuses it", () => {
    const signer = generateKeyPairSync("ed25519");
    const other = generateKeyPairSync("ed25519");
    const { result, manifestFile } = release(
      manifest,
      `${pkcs8(signer.privateKey)}\n`,
    );
    expect(result.status, result.stderr).toBe(0);
    const signatureFile: unknown = JSON.parse(
      readFileSync(`${manifestFile}.sig`, "utf8"),
    );
    const spki = (key: typeof signer) =>
      key.publicKey.export({ format: "der", type: "spki" }).toString("base64");
    const bytes = readFileSync(manifestFile);
    expect(signedByRelease(bytes, signatureFile, [spki(signer)])).toBe(true);
    expect(
      signedByRelease(bytes, signatureFile, [spki(other), spki(signer)]),
    ).toBe(true);
    expect(signedByRelease(bytes, signatureFile, [spki(other)])).toBe(false);
    expect(
      signedByRelease(
        Buffer.from(manifest.replace("a".repeat(64), "c".repeat(64))),
        signatureFile,
        [spki(signer)],
      ),
    ).toBe(false);
  });
  // @req R-CAP-30
  it("refuses an unstamped manifest, an empty key and a key that is not Ed25519, and writes no signature", () => {
    const signer = pkcs8(generateKeyPairSync("ed25519").privateKey);
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 })
      .privateKey.export({ format: "der", type: "pkcs8" })
      .toString("base64");
    for (const [manifestText, keyText, message] of [
      [
        manifest.replace(/,"builtAt":"[^"]+"/, ""),
        signer,
        "carries no builtAt stamp",
      ],
      [manifest, "\n", "The hook signing key file is empty."],
      [manifest, rsa, "must be an Ed25519 key"],
    ] as const) {
      const { result, manifestFile } = release(manifestText, keyText);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(message);
      expect(() => readFileSync(`${manifestFile}.sig`)).toThrow();
    }
  });
});
