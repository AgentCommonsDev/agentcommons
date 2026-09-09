import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

/** Domain separation for the reveal key; bump the suffix if the derivation changes. */
const derivationInfo = "agentcommons/api-key-reveal/v1";
const algorithm = "aes-256-gcm";
const ivLength = 12;
const tagLength = 16;

/** The persisted shape of one encrypted API key (`api_key_secret`). */
interface SealedKeySecret {
  ciphertext: Uint8Array<ArrayBuffer>;
  iv: Uint8Array<ArrayBuffer>;
  tag: Uint8Array<ArrayBuffer>;
}
/** Prisma `Bytes` columns take plain `Uint8Array` values over their own buffer. */
const bytes = (value: Buffer): Uint8Array<ArrayBuffer> => new Uint8Array(value);

/**
 * AES-256-GCM over API key plaintext with a key derived once per process from the
 * server secret (HKDF-SHA256). The key id is authenticated as associated data so a
 * ciphertext cannot be moved to another key's row (ADR 0051).
 */
export class KeySecretCipher {
  private readonly key: Buffer;
  constructor(serverSecret: string) {
    this.key = Buffer.from(
      hkdfSync("sha256", serverSecret, "", derivationInfo, 32),
    );
  }

  seal(keyId: string, plaintext: string): SealedKeySecret {
    const iv = randomBytes(ivLength);
    const cipher = createCipheriv(algorithm, this.key, iv, {
      authTagLength: tagLength,
    });
    cipher.setAAD(Buffer.from(keyId, "utf8"));
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    return {
      ciphertext: bytes(ciphertext),
      iv: bytes(iv),
      tag: bytes(cipher.getAuthTag()),
    };
  }

  open(keyId: string, sealed: SealedKeySecret): string {
    const decipher = createDecipheriv(
      algorithm,
      this.key,
      Buffer.from(sealed.iv),
      { authTagLength: tagLength },
    );
    decipher.setAAD(Buffer.from(keyId, "utf8"));
    decipher.setAuthTag(Buffer.from(sealed.tag));
    return Buffer.concat([
      decipher.update(Buffer.from(sealed.ciphertext)),
      decipher.final(),
    ]).toString("utf8");
  }
}
