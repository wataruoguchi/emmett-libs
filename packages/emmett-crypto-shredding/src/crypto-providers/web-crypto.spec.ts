import { describe, expect, it } from "vitest";
import { CryptoOperationError } from "../errors.js";
import { createWebCryptoProvider } from "../index.js";

describe("Feature: Web Crypto Provider", () => {
  // Helper functions
  function randomBytes(len: number): Uint8Array {
    const b = new Uint8Array(len);
    crypto.getRandomValues(b);
    return b;
  }

  function createProvider() {
    return createWebCryptoProvider();
  }

  describe("Scenario: Encryption and Decryption", () => {
    it("Given AES-GCM algorithm, When encrypting and decrypting, Then data should round-trip correctly", async () => {
      const provider = createProvider();
      const key = randomBytes(32);
      const iv = randomBytes(12);
      const aad = new TextEncoder().encode("partition:stream-123");
      const plaintext = new TextEncoder().encode("hello world");

      const ciphertext = await provider.encrypt(
        "AES-GCM",
        key,
        iv,
        plaintext,
        aad,
      );
      expect(ciphertext).toBeInstanceOf(Uint8Array);
      expect(ciphertext.byteLength).toBeGreaterThan(plaintext.byteLength);

      const decrypted = await provider.decrypt(
        "AES-GCM",
        key,
        iv,
        ciphertext,
        aad,
      );
      expect(new TextDecoder().decode(decrypted)).toBe("hello world");
    });
  });

  describe("Scenario: Error Handling", () => {
    it("Given invalid algorithm, When encrypting, Then it should throw CryptoOperationError", async () => {
      const provider = createProvider();
      const key = randomBytes(32);
      const iv = randomBytes(12);
      const data = new Uint8Array([1, 2, 3]);

      await expect(
        provider.encrypt("INVALID" as any, key, iv, data),
      ).rejects.toBeInstanceOf(CryptoOperationError);
    });

    it("Given tampered ciphertext, When decrypting, Then it should throw CryptoOperationError", async () => {
      const provider = createProvider();
      const key = randomBytes(32);
      const iv = randomBytes(12);
      const data = new TextEncoder().encode("integrity check");
      const ct = await provider.encrypt("AES-GCM", key, iv, data);
      // Tamper a byte
      const tampered = new Uint8Array(ct);
      tampered[0] = tampered[0] ^ 0xff;

      await expect(
        provider.decrypt("AES-GCM", key, iv, tampered),
      ).rejects.toBeInstanceOf(CryptoOperationError);
    });
  });
});
