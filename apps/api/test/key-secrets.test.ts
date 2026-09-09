import { expect, it } from "vitest";
import { KeySecretCipher } from "../src/services/key-secrets.js";

const secret = "unit-test-server-secret-with-at-least-32-characters";

// @req R-AUTH-05
it("round-trips a key under the derived key and rejects other rows, tampering and other secrets", () => {
  const cipher = new KeySecretCipher(secret);
  const plaintext = "ac_unit_test_key_value_0123456789";
  const sealed = cipher.seal("key-1", plaintext);
  expect(sealed.iv).toHaveLength(12);
  expect(sealed.tag).toHaveLength(16);
  expect(Buffer.from(sealed.ciphertext).includes(plaintext)).toBe(false);
  expect(cipher.open("key-1", sealed)).toBe(plaintext);
  // Two seals of the same value never share an IV or ciphertext.
  const again = cipher.seal("key-1", plaintext);
  expect(Buffer.from(again.iv).equals(Buffer.from(sealed.iv))).toBe(false);
  expect(
    Buffer.from(again.ciphertext).equals(Buffer.from(sealed.ciphertext)),
  ).toBe(false);
  // The key id is authenticated, so a ciphertext cannot be moved to another key's row.
  expect(() => cipher.open("key-2", sealed)).toThrow();
  const tampered = new Uint8Array(sealed.ciphertext);
  tampered[0] = tampered[0] === undefined ? 0 : tampered[0] ^ 1;
  expect(() =>
    cipher.open("key-1", { ...sealed, ciphertext: tampered }),
  ).toThrow();
  expect(() =>
    new KeySecretCipher(`${secret}-rotated`).open("key-1", sealed),
  ).toThrow();
  // The same secret always derives the same key, so a restarted process can still open rows.
  expect(new KeySecretCipher(secret).open("key-1", sealed)).toBe(plaintext);
});
