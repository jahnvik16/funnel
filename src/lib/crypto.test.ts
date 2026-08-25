import { test } from "node:test";
import assert from "node:assert/strict";
import { encryptSecret, decryptSecret } from "./crypto";

// A 32-byte base64 key, used only for this test — not a real secret.
process.env.ENCRYPTION_KEY = "ckWuw+87XPyLEtgfBxk6sfI8nBRzZqfHrzCpB+j/42g=";

test("encryptSecret never returns the plaintext value", () => {
  const ciphertext = encryptSecret("super-secret-token");
  assert.notEqual(ciphertext, "super-secret-token");
});

test("decryptSecret recovers the original plaintext", () => {
  const ciphertext = encryptSecret("super-secret-token");
  assert.equal(decryptSecret(ciphertext), "super-secret-token");
});

test("encrypting the same plaintext twice produces different ciphertext", () => {
  const a = encryptSecret("same-value");
  const b = encryptSecret("same-value");
  assert.notEqual(a, b);
});

test("decryptSecret rejects malformed ciphertext", () => {
  assert.throws(() => decryptSecret("not-valid-ciphertext"));
});
