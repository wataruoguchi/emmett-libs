/**
 * Database schema types for crypto shredding tables.
 * These types define the structure of the encryption_keys and encryption_policies tables.
 */

export interface EncryptionKeysTable {
  key_id: string;
  partition: string;
  key_material: Buffer; // BYTEA in PostgreSQL
  key_version: number;
  created_at: Date;
  updated_at: Date;
  destroyed_at: Date | null;
  is_active: boolean;
}

export interface EncryptionPoliciesTable {
  policy_id: string;
  stream_type_class: string;
  partition: string;
  key_scope: string;
  encryption_algorithm: string | null;
  key_rotation_interval_days: number | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Database schema interface that includes the crypto shredding tables.
 * Extend your database type with this interface to use the Kysely adapters.
 *
 * @example
 * ```typescript
 * import type { CryptoDatabase } from '@wataruoguchi/emmett-crypto-shredding-kysely';
 * import type { EventStoreDBSchema } from '@wataruoguchi/emmett-event-store-kysely';
 *
 * interface MyDatabase extends EventStoreDBSchema, CryptoDatabase {}
 * ```
 */
export interface CryptoDatabase {
  encryption_keys: EncryptionKeysTable;
  encryption_policies: EncryptionPoliciesTable;
}
