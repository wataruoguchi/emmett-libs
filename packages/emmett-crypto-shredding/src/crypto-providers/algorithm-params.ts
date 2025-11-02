import { UnsupportedAlgorithmError } from "../errors.js";
import type { SupportedAlgorithm } from "../types.js";

/**
 * Algorithm parameter definitions for Web Crypto API
 */
export interface AlgorithmParams {
  name: string;
  tagLength?: number;
}

/**
 * Get Web Crypto API parameters for a supported algorithm
 *
 * tagLength is the length of the authentication tag in bits. It affects the strength of the authentication tag.
 * 32, 64, 96, 128 bits are supported.
 */
export function getAlgorithmParams(
  algorithmName: SupportedAlgorithm,
): AlgorithmParams {
  switch (algorithmName) {
    case "AES-GCM":
      return { name: algorithmName, tagLength: 128 };
    case "AES-CBC":
    case "AES-CTR":
      return { name: algorithmName };
    default:
      throw new UnsupportedAlgorithmError(
        algorithmName,
        getAllSupportedAlgorithms(),
      );
  }
}

/**
 * Get all supported algorithms
 */
export function getAllSupportedAlgorithms(): SupportedAlgorithm[] {
  return ["AES-GCM", "AES-CBC", "AES-CTR"];
}
/**
 * Get Web Crypto API key generation parameters for a supported algorithm
 *
 * length is the length of the key in bits. It affects the strength of the key.
 * 128, 192, 256 bits are supported.
 */
export function getKeyGenerationParams(
  algorithm: SupportedAlgorithm,
):
  | AlgorithmIdentifier
  | RsaHashedKeyGenParams
  | EcKeyGenParams
  | HmacKeyGenParams
  | AesKeyGenParams {
  const params = getAlgorithmParams(algorithm);

  switch (algorithm) {
    case "AES-GCM":
    case "AES-CBC":
    case "AES-CTR":
      return { name: params.name, length: 192 };
    default:
      throw new UnsupportedAlgorithmError(
        algorithm,
        getAllSupportedAlgorithms(),
      );
  }
}

/**
 * Check if an algorithm supports additional authenticated data (AAD)
 */
export function supportsAdditionalData(algorithm: SupportedAlgorithm): boolean {
  return algorithm === "AES-GCM";
}
