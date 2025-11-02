import { CryptoOperationError, WebCryptoNotAvailableError } from "../errors.js";
import type { CryptoProvider, SupportedAlgorithm } from "../types.js";
import { getAlgorithmParams } from "./algorithm-params.js";
import { validateAlgorithmSupport } from "./runtime-detection.js";

/**
 * Creates a Web Crypto API-based crypto provider for use with the crypto-shredding package.
 *
 * This provider uses the Web Crypto API available in Node.js 20+ and modern browsers.
 * It supports multiple encryption algorithms with runtime detection.
 *
 * @returns A CryptoProvider implementation using Web Crypto API
 * @throws Error if Web Crypto API is not available in the environment
 *
 * @example
 * ```typescript
 * import { createWebCryptoProvider } from '@wataruoguchi/emmett-crypto-shredding';
 *
 * const cryptoProvider = createWebCryptoProvider();
 * const cryptoStore = createCryptoEventStore(baseStore, {
 *   policy: myPolicy,
 *   keys: myKeyManagement,
 *   crypto: cryptoProvider,
 * });
 * ```
 */
export function createWebCryptoProvider(): CryptoProvider {
  const globalCrypto = globalThis.crypto;

  if (!globalCrypto?.subtle) {
    throw new WebCryptoNotAvailableError();
  }

  const subtle = globalCrypto.subtle;

  async function performCryptoOperation(
    operation: "encrypt" | "decrypt",
    algo: SupportedAlgorithm,
    keyBytes: Uint8Array,
    iv: Uint8Array,
    data: Uint8Array,
    aad?: Uint8Array,
  ): Promise<Uint8Array> {
    try {
      await validateAlgorithmSupport(algo);
      const algorithmParams = getAlgorithmParams(algo);

      // All supported algorithms can import raw keys
      const key = await subtle.importKey(
        "raw",
        keyBytes as BufferSource,
        algorithmParams.name,
        false,
        [operation],
      );

      // Build algorithm-specific parameters for Web Crypto API
      type AesGcmParams = {
        name: "AES-GCM";
        iv: BufferSource;
        tagLength?: number;
        additionalData?: BufferSource;
      };
      type AesCbcParams = {
        name: "AES-CBC";
        iv: BufferSource;
      };
      type AesCtrParams = {
        name: "AES-CTR";
        iv: BufferSource;
        counter: BufferSource;
        length: number;
      };

      const baseParams = {
        ...algorithmParams,
        iv: iv as BufferSource,
      };

      const params: AesGcmParams | AesCbcParams | AesCtrParams =
        algo === "AES-GCM"
          ? {
              ...(baseParams as AesGcmParams),
              ...(aad ? { additionalData: aad as BufferSource } : {}),
            }
          : algo === "AES-CBC"
            ? (baseParams as AesCbcParams)
            : {
                ...(baseParams as AesCtrParams),
                counter: iv as BufferSource,
                length: 128,
              };

      const result =
        operation === "encrypt"
          ? await subtle.encrypt(params, key, data as BufferSource)
          : await subtle.decrypt(params, key, data as BufferSource);

      return new Uint8Array(result);
    } catch (error) {
      // Re-throw CryptoOperationError as-is
      if (error instanceof CryptoOperationError) {
        throw error;
      }
      throw new CryptoOperationError(
        `${operation === "encrypt" ? "Encryption" : "Decryption"} failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        operation,
        algo,
        error instanceof Error ? error : undefined,
      );
    }
  }

  return {
    async encrypt(
      algo: SupportedAlgorithm,
      keyBytes: Uint8Array,
      iv: Uint8Array,
      plaintext: Uint8Array,
      aad?: Uint8Array,
    ) {
      return performCryptoOperation(
        "encrypt",
        algo,
        keyBytes,
        iv,
        plaintext,
        aad,
      );
    },

    async decrypt(
      algo: SupportedAlgorithm,
      keyBytes: Uint8Array,
      iv: Uint8Array,
      ciphertext: Uint8Array,
      aad?: Uint8Array,
    ) {
      return performCryptoOperation(
        "decrypt",
        algo,
        keyBytes,
        iv,
        ciphertext,
        aad,
      );
    },
  };
}
