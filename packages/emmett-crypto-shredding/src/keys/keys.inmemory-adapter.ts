import type { KeyManagement } from "../types.js";
import { createKeyManagement, type KeyStorage } from "./keys.core.js";

/**
 * In-memory KeyStorage implementation for testing and development.
 * This provides a simple in-memory storage that can be used with createKeyManagement.
 */
function createInMemoryStorage(): KeyStorage {
  const store = new Map<
    string,
    { keyId: string; keyVersion: number; keyMaterial: Uint8Array }
  >();

  function keyName(partition: string, keyRef: string) {
    return `${partition}::${keyRef}`;
  }

  return {
    async findActiveKey({ partition, keyRef }) {
      const name = keyName(partition, keyRef);
      const entry = store.get(name);
      if (!entry) {
        return null;
      }
      return {
        keyId: entry.keyId,
        keyVersion: entry.keyVersion,
        keyMaterial: entry.keyMaterial,
      };
    },

    async findKeyById({ partition, keyId }) {
      // Parse keyId to extract partition and keyRef
      const parts = keyId.split("::");
      if (parts.length !== 2) return null;
      if (parts[0] !== partition) return null;

      const keyRefAndVersion = parts[1];
      const versionMatch = keyRefAndVersion.match(/@(\d+)$/);
      if (!versionMatch) return null;

      const version = parseInt(versionMatch[1], 10);
      const keyRef = keyRefAndVersion.slice(0, -versionMatch[0].length);
      const name = keyName(partition, keyRef);
      const entry = store.get(name);
      if (!entry || entry.keyVersion !== version) {
        return null;
      }

      return {
        keyId: entry.keyId,
        keyVersion: entry.keyVersion,
        keyMaterial: entry.keyMaterial,
      };
    },

    async findCurrentActiveKeyVersion({ partition, keyRef }) {
      const name = keyName(partition, keyRef);
      const entry = store.get(name);
      return entry?.keyVersion ?? null;
    },

    async insertKey({ keyId, partition, keyMaterial, keyVersion }) {
      const keyRef = keyId.split("::")[1]?.split("@")[0] ?? "";
      const name = keyName(partition, keyRef);
      store.set(name, { keyId, keyVersion, keyMaterial });
    },

    async deactivateKeys(_params: { partition: string; keyRef: string }) {
      // In-memory: just replace with new key (rotation already creates new key)
      // This is simplified for testing - deactivation happens automatically during rotation
    },

    async destroyPartitionKeys({ partition }) {
      for (const key of Array.from(store.keys())) {
        if (key.startsWith(`${partition}::`)) {
          store.delete(key);
        }
      }
    },
  };
}

/**
 * In-memory KeyManagement implementation for testing and development.
 *
 * This implementation stores keys in memory and is useful for testing
 * or when you don't need persistent key storage.
 */
export function createInMemoryKeys(): KeyManagement {
  const storage = createInMemoryStorage();
  return createKeyManagement(storage);
}
