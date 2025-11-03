import {
  createKeyManagement as createKeyManagementCore,
  type KeyManagement,
  type KeyStorage,
} from "@wataruoguchi/emmett-crypto-shredding";
import type { Kysely } from "kysely";

/**
 * Kysely-specific implementation of KeyStorage interface.
 * This adapter translates the abstract KeyStorage operations into Kysely queries.
 *
 * Note: The database type DB must include the encryption_keys and encryption_policies tables
 * defined in CryptoDatabase, but we use a flexible type constraint to work with any
 * Kysely instance that has these tables.
 *
 * The `Kysely<any> | any` type is intentional to work around Kysely's private field variance
 * issue in TypeScript, allowing DatabaseExecutor and other Kysely-compatible types to be passed.
 * The `as any` casts for table names are necessary because Kysely cannot infer types for
 * dynamically accessed table names at compile time.
 */
function createKyselyKeyStorage(db: Kysely<any> | any): KeyStorage {
  return {
    async findActiveKey({
      partition,
      keyRef,
    }: {
      partition: string;
      keyRef: string;
    }) {
      const result = await (db.selectFrom("encryption_keys" as any) as any)
        .select(["key_id", "key_version", "key_material"])
        .where("partition", "=", partition)
        .where("key_id", "like", `${partition}::${keyRef}@%`)
        .where("is_active", "=", true)
        .where("destroyed_at", "is", null)
        .orderBy("key_version", "desc")
        .executeTakeFirst();

      if (!result) {
        return null;
      }

      return {
        keyId: result.key_id,
        keyVersion: result.key_version,
        keyMaterial: new Uint8Array(result.key_material as Buffer),
      };
    },

    async findKeyById({
      partition,
      keyId,
    }: {
      partition: string;
      keyId: string;
    }) {
      const result = await (db.selectFrom("encryption_keys" as any) as any)
        .select(["key_id", "key_version", "key_material"])
        .where("key_id", "=", keyId)
        .where("partition", "=", partition)
        .where("destroyed_at", "is", null)
        .executeTakeFirst();

      if (!result) {
        return null;
      }

      return {
        keyId: result.key_id,
        keyVersion: result.key_version,
        keyMaterial: new Uint8Array(result.key_material as Buffer),
      };
    },

    async findCurrentActiveKeyVersion({
      partition,
      keyRef,
    }: {
      partition: string;
      keyRef: string;
    }) {
      const result = await (db.selectFrom("encryption_keys" as any) as any)
        .select(["key_version"])
        .where("partition", "=", partition)
        .where("key_id", "like", `${partition}::${keyRef}@%`)
        .where("is_active", "=", true)
        .where("destroyed_at", "is", null)
        .orderBy("key_version", "desc")
        .executeTakeFirst();

      return result?.key_version ?? null;
    },

    async insertKey({
      keyId,
      partition,
      keyMaterial,
      keyVersion,
    }: {
      keyId: string;
      partition: string;
      keyMaterial: Uint8Array;
      keyVersion: number;
    }) {
      await (db.insertInto("encryption_keys" as any) as any)
        .values({
          key_id: keyId,
          partition: partition,
          key_material: Buffer.from(keyMaterial),
          key_version: keyVersion,
          is_active: true,
          destroyed_at: null,
        })
        .execute();
    },

    async deactivateKeys({
      partition,
      keyRef,
    }: {
      partition: string;
      keyRef: string;
    }) {
      await (db.updateTable("encryption_keys" as any) as any)
        .set({ is_active: false, updated_at: new Date() })
        .where("partition", "=", partition)
        .where("key_id", "like", `${partition}::${keyRef}@%`)
        .where("is_active", "=", true)
        .execute();
    },

    async destroyPartitionKeys({ partition }: { partition: string }) {
      await (db.updateTable("encryption_keys" as any) as any)
        .set({
          destroyed_at: new Date(),
        })
        .where("partition", "=", partition)
        .where("destroyed_at", "is", null)
        .execute();
    },
  };
}

/**
 * Create a KeyManagement implementation backed by a Kysely database.
 * This is a convenience function that combines the database-agnostic logic
 * with the Kysely-specific adapter.
 *
 * @param db - Kysely database instance that includes the CryptoDatabase schema
 * @returns KeyManagement instance for key generation, rotation, and destruction
 *
 * @example
 * ```typescript
 * import { createKeyManagement } from '@wataruoguchi/emmett-crypto-shredding-kysely';
 * import type { MyDatabase } from './db-types';
 *
 * const keyManagement = createKeyManagement(db);
 * const key = await keyManagement.getActiveKey({
 *   partition: 'tenant-123',
 *   keyRef: 'user-data'
 * });
 * ```
 */
export function createKeyManagement(db: Kysely<any> | any): KeyManagement {
  const storage = createKyselyKeyStorage(db);
  return createKeyManagementCore(storage);
}

/**
 * Create a KeyStorage adapter for a Kysely database.
 * This is a lower-level function if you need direct access to the storage adapter.
 *
 * @param db - Kysely database instance that includes the CryptoDatabase schema
 * @returns KeyStorage instance
 */
export function createKeyStorage(db: Kysely<any> | any): KeyStorage {
  return createKyselyKeyStorage(db);
}
