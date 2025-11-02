import { UnsupportedAlgorithmError } from "../errors.js";
import type { SupportedAlgorithm } from "../types.js";
import { getKeyGenerationParams } from "./algorithm-params.js";

/**
 * Runtime environment information for crypto algorithm support
 */
export interface RuntimeInfo {
  nodeVersion?: string;
  supportedAlgorithms: SupportedAlgorithm[];
}

/**
 * Test if a specific algorithm is supported in the current runtime
 */
export async function isAlgorithmSupported(
  algorithm: SupportedAlgorithm,
): Promise<boolean> {
  if (!globalThis.crypto?.subtle) {
    return false;
  }

  try {
    const keyGenParams = getKeyGenerationParams(algorithm);
    await globalThis.crypto.subtle.generateKey(keyGenParams, false, [
      "encrypt",
      "decrypt",
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect the current Node.js runtime environment and supported algorithms
 */
export async function detectRuntimeInfo(): Promise<RuntimeInfo> {
  const supportedAlgorithms: SupportedAlgorithm[] = [];

  // Test each algorithm
  const algorithms = ["AES-GCM", "AES-CBC", "AES-CTR"] as SupportedAlgorithm[];

  for (const algorithm of algorithms) {
    if (await isAlgorithmSupported(algorithm)) {
      supportedAlgorithms.push(algorithm);
    }
  }

  // Detect runtime environment
  const runtimeInfo: RuntimeInfo = {
    supportedAlgorithms,
  };

  // Check if we're in Node.js
  if (typeof process !== "undefined" && process.version) {
    runtimeInfo.nodeVersion = process.version;
  }

  return runtimeInfo;
}

/**
 * Get the best supported algorithm for the current Node.js runtime
 * Returns the most secure algorithm that's widely supported
 */
export async function getBestSupportedAlgorithm(): Promise<SupportedAlgorithm> {
  const runtimeInfo = await detectRuntimeInfo();

  // Priority order: most secure and widely supported first
  const priorityOrder: SupportedAlgorithm[] = [
    "AES-GCM", // Authenticated encryption, universal support
    "AES-CTR", // Counter mode, needs separate MAC
    "AES-CBC", // Block cipher, needs separate MAC
  ];

  for (const algorithm of priorityOrder) {
    if (runtimeInfo.supportedAlgorithms.includes(algorithm)) {
      return algorithm;
    }
  }

  throw new UnsupportedAlgorithmError(
    "No supported encryption algorithms found",
    [],
    runtimeInfo.nodeVersion,
  );
}

/**
 * Validate that the requested algorithm is supported
 */
export async function validateAlgorithmSupport(
  algorithm: SupportedAlgorithm,
): Promise<void> {
  if (!(await isAlgorithmSupported(algorithm))) {
    const runtimeInfo = await detectRuntimeInfo();
    const runtime = runtimeInfo.nodeVersion || "unknown";

    throw new UnsupportedAlgorithmError(
      algorithm,
      runtimeInfo.supportedAlgorithms,
      runtime,
    );
  }
}
