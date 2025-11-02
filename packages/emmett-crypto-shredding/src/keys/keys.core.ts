import type { KeyManagement } from "../types.js";

/**
 * Database-agnostic interfaces for key storage operations.
 * These interfaces abstract away the specific database implementation.
 */
export interface KeyStorage {
  findActiveKey(params: { partition: string; keyRef: string }): Promise<{
    keyId: string;
    keyVersion: number;
    keyMaterial: Uint8Array;
  } | null>;

  findKeyById(params: { partition: string; keyId: string }): Promise<{
    keyId: string;
    keyVersion: number;
    keyMaterial: Uint8Array;
  } | null>;

  findCurrentActiveKeyVersion(params: {
    partition: string;
    keyRef: string;
  }): Promise<number | null>;

  insertKey(params: {
    keyId: string;
    partition: string;
    keyMaterial: Uint8Array;
    keyVersion: number;
  }): Promise<void>;

  deactivateKeys(params: { partition: string; keyRef: string }): Promise<void>;

  destroyPartitionKeys(params: { partition: string }): Promise<void>;
}

/**
 * Utility functions for key management (database-agnostic)
 */
export function randomKey(): Uint8Array {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function generateKeyId(
  partition: string,
  keyRef: string,
  version: number,
): string {
  return `${partition}::${keyRef}@${version}`;
}

/**
 * Database-agnostic KeyManagement implementation.
 */
export function createKeyManagement(storage: KeyStorage): KeyManagement {
  return {
    async getActiveKey({ partition, keyRef }) {
      const result = await storage.findActiveKey({ partition, keyRef });

      if (!result) {
        // Create a new key if none exists
        const keyVersion = 1;
        const keyId = generateKeyId(partition, keyRef, keyVersion);
        const keyBytes = randomKey();

        await storage.insertKey({
          keyId,
          partition,
          keyMaterial: keyBytes,
          keyVersion,
        });

        return { keyId, keyVersion, keyBytes };
      }

      return {
        keyId: result.keyId,
        keyVersion: result.keyVersion,
        keyBytes: result.keyMaterial,
      };
    },

    async getKeyById({ partition, keyId }) {
      const result = await storage.findKeyById({ partition, keyId });
      if (!result) {
        return null;
      }

      return {
        keyId: result.keyId,
        keyVersion: result.keyVersion,
        keyBytes: result.keyMaterial,
      };
    },

    async rotateKey({ partition, keyRef }) {
      const currentVersion = await storage.findCurrentActiveKeyVersion({
        partition,
        keyRef,
      });

      const nextVersion = (currentVersion ?? 0) + 1;
      const keyId = generateKeyId(partition, keyRef, nextVersion);
      const keyBytes = randomKey();

      // Deactivate the current key if it exists
      if (currentVersion !== null) {
        await storage.deactivateKeys({ partition, keyRef });
      }

      // Create the new key
      await storage.insertKey({
        keyId,
        partition,
        keyMaterial: keyBytes,
        keyVersion: nextVersion,
      });

      return { keyId, keyVersion: nextVersion };
    },

    async destroyPartitionKeys(partition: string) {
      await storage.destroyPartitionKeys({ partition });
    },
  };
}
