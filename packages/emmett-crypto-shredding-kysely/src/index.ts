/**
 * @wataruoguchi/emmett-crypto-shredding-kysely
 *
 * Kysely adapters for Emmett Crypto Shredding.
 * Provides database-specific implementations for key storage and policy resolution
 * using Kysely query builder.
 */

// Export schema types
export type {
  CryptoDatabase,
  EncryptionKeysTable,
  EncryptionPoliciesTable,
} from "./schema/crypto-schema.js";

// Export key storage adapters
export {
  createKeyManagement,
  createKeyStorage,
} from "./adapters/keys.kysely-adapter.js";

// Export policy storage adapters
export {
  createDefaultPolicies,
  createPolicies,
  createPolicyResolver,
  createPolicyStorage,
  deletePolicy,
  listPolicies,
  updatePolicy,
  type DatabasePolicyConfig,
  type Logger,
} from "./adapters/policy.kysely-adapter.js";
