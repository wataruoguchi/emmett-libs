// Re-export all types from the types module
export * from "./types.js";

// Export store factory
export { createCryptoEventStore } from "./store/create-crypto-event-store.js";

// Export crypto provider implementations
export { createWebCryptoProvider } from "./crypto-providers/web-crypto.js";

// Export algorithm detection utilities
export {
  detectRuntimeInfo,
  getBestSupportedAlgorithm,
  isAlgorithmSupported,
  validateAlgorithmSupport,
  type RuntimeInfo,
} from "./crypto-providers/runtime-detection.js";

export {
  getAlgorithmParams,
  getAllSupportedAlgorithms,
  getKeyGenerationParams,
  supportsAdditionalData,
  type AlgorithmParams,
} from "./crypto-providers/algorithm-params.js";

// Export default policies
export {
  getDefaultPolicies,
  type PolicyConfig,
} from "./policy/default-policies.js";

// Export policy resolver
export {
  createPolicyResolver,
  type KeyScope,
  type PolicyData,
  type PolicyStorage,
} from "./policy/policy.resolver.js";

// Export key management core
export {
  createKeyManagement,
  generateKeyId,
  randomKey,
  type KeyStorage,
} from "./keys/keys.core.js";

// Export in-memory key adapter
export { createInMemoryKeys } from "./keys/keys.inmemory-adapter.js";

// Export error types
export {
  CryptoOperationError,
  CryptoShreddingError,
  InvalidDataFormatError,
  InvalidParameterError,
  KeyManagementError,
  PolicyResolutionError,
  UnsupportedAlgorithmError,
  WebCryptoNotAvailableError,
} from "./errors.js";
