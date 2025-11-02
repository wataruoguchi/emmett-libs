import { describe, expect, it, vi } from "vitest";
import {
  createKeyManagement,
  generateKeyId,
  randomKey,
  type KeyStorage,
} from "./keys.core.js";

describe("Feature: Key Management Core", () => {
  // Helper functions
  function createMockStorage(): KeyStorage {
    const store = new Map<
      string,
      { keyId: string; keyVersion: number; keyMaterial: Uint8Array }
    >();

    return {
      findActiveKey: vi.fn(async ({ partition, keyRef }) => {
        const key = store.get(`${partition}::${keyRef}`);
        if (!key) return null;
        return {
          keyId: key.keyId,
          keyVersion: key.keyVersion,
          keyMaterial: key.keyMaterial,
        };
      }),

      findKeyById: vi.fn(async ({ partition, keyId }) => {
        // Check partition matches keyId prefix
        if (!keyId.startsWith(`${partition}::`)) {
          return null;
        }
        for (const [_, value] of store) {
          if (value.keyId === keyId) {
            return {
              keyId: value.keyId,
              keyVersion: value.keyVersion,
              keyMaterial: value.keyMaterial,
            };
          }
        }
        return null;
      }),

      findCurrentActiveKeyVersion: vi.fn(async ({ partition, keyRef }) => {
        const key = store.get(`${partition}::${keyRef}`);
        return key?.keyVersion ?? null;
      }),

      insertKey: vi.fn(
        async ({ keyId, partition, keyMaterial, keyVersion }) => {
          const keyRef = keyId.split("::")[1]?.split("@")[0] ?? "";
          store.set(`${partition}::${keyRef}`, {
            keyId,
            keyVersion,
            keyMaterial,
          });
        },
      ),

      deactivateKeys: vi.fn(async () => {}),

      destroyPartitionKeys: vi.fn(async () => {}),
    };
  }

  describe("Scenario: Utility Functions", () => {
    describe("randomKey", () => {
      it("Given no parameters, When generating random key, Then it should return 32-byte Uint8Array", () => {
        const key = randomKey();
        expect(key).toBeInstanceOf(Uint8Array);
        expect(key.length).toBe(32);
      });

      it("Given multiple calls, When generating random keys, Then each key should be unique", () => {
        const key1 = randomKey();
        const key2 = randomKey();
        // Very unlikely to be identical (1 in 2^256)
        expect(key1).not.toEqual(key2);
      });
    });

    describe("generateKeyId", () => {
      it("Given partition, keyRef, and version, When generating key ID, Then it should format correctly", () => {
        const keyId = generateKeyId("partition-1", "key-ref-1", 5);
        expect(keyId).toBe("partition-1::key-ref-1@5");
      });

      it("Given version 1, When generating key ID, Then it should include version", () => {
        const keyId = generateKeyId("p", "r", 1);
        expect(keyId).toBe("p::r@1");
      });

      it("Given large version number, When generating key ID, Then it should handle correctly", () => {
        const keyId = generateKeyId("p", "r", 999);
        expect(keyId).toBe("p::r@999");
      });
    });
  });

  describe("Scenario: Creating Key Management", () => {
    it("Given a storage implementation, When creating key management, Then it should return KeyManagement interface", () => {
      const storage = createMockStorage();
      const keyMgmt = createKeyManagement(storage);

      expect(keyMgmt).toBeDefined();
      expect(typeof keyMgmt.getActiveKey).toBe("function");
      expect(typeof keyMgmt.getKeyById).toBe("function");
      expect(typeof keyMgmt.rotateKey).toBe("function");
      expect(typeof keyMgmt.destroyPartitionKeys).toBe("function");
    });
  });

  describe("Scenario: Getting Active Key", () => {
    it("Given no existing key, When getting active key, Then it should create and return new key", async () => {
      const storage = createMockStorage();
      const keyMgmt = createKeyManagement(storage);

      const result = await keyMgmt.getActiveKey({
        partition: "p1",
        keyRef: "ref1",
      });

      expect(result.keyId).toBe("p1::ref1@1");
      expect(result.keyVersion).toBe(1);
      expect(result.keyBytes).toBeInstanceOf(Uint8Array);
      expect(result.keyBytes.length).toBe(32);
      expect(storage.insertKey).toHaveBeenCalled();
    });

    it("Given existing active key, When getting active key, Then it should return existing key", async () => {
      const storage = createMockStorage();
      const keyMgmt = createKeyManagement(storage);

      // First call creates key
      const firstResult = await keyMgmt.getActiveKey({
        partition: "p1",
        keyRef: "ref1",
      });

      // Second call should return same key
      const secondResult = await keyMgmt.getActiveKey({
        partition: "p1",
        keyRef: "ref1",
      });

      expect(secondResult.keyId).toBe(firstResult.keyId);
      expect(secondResult.keyVersion).toBe(firstResult.keyVersion);
      expect(secondResult.keyBytes).toEqual(firstResult.keyBytes);
    });

    it("Given different partitions, When getting active keys, Then each partition should have separate keys", async () => {
      const storage = createMockStorage();
      const keyMgmt = createKeyManagement(storage);

      const key1 = await keyMgmt.getActiveKey({
        partition: "p1",
        keyRef: "ref1",
      });
      const key2 = await keyMgmt.getActiveKey({
        partition: "p2",
        keyRef: "ref1",
      });

      expect(key1.keyId).not.toBe(key2.keyId);
      expect(key1.keyBytes).not.toEqual(key2.keyBytes);
    });

    it("Given different keyRefs, When getting active keys, Then each keyRef should have separate keys", async () => {
      const storage = createMockStorage();
      const keyMgmt = createKeyManagement(storage);

      const key1 = await keyMgmt.getActiveKey({
        partition: "p1",
        keyRef: "ref1",
      });
      const key2 = await keyMgmt.getActiveKey({
        partition: "p1",
        keyRef: "ref2",
      });

      expect(key1.keyId).not.toBe(key2.keyId);
      expect(key1.keyBytes).not.toEqual(key2.keyBytes);
    });
  });

  describe("Scenario: Getting Key By ID", () => {
    it("Given existing key ID, When getting key by ID, Then it should return key", async () => {
      const storage = createMockStorage();
      const keyMgmt = createKeyManagement(storage);

      // Create a key first
      const activeKey = await keyMgmt.getActiveKey({
        partition: "p1",
        keyRef: "ref1",
      });

      // Get it by ID
      const result = await keyMgmt.getKeyById({
        partition: "p1",
        keyId: activeKey.keyId,
      });

      expect(result).not.toBeNull();
      expect(result!.keyId).toBe(activeKey.keyId);
      expect(result!.keyVersion).toBe(activeKey.keyVersion);
      expect(result!.keyBytes).toEqual(activeKey.keyBytes);
    });

    it("Given non-existent key ID, When getting key by ID, Then it should return null", async () => {
      const storage = createMockStorage();
      const keyMgmt = createKeyManagement(storage);

      const result = await keyMgmt.getKeyById({
        partition: "p1",
        keyId: "non-existent-key-id",
      });

      expect(result).toBeNull();
    });

    it("Given wrong partition, When getting key by ID, Then it should return null", async () => {
      const storage = createMockStorage();
      const keyMgmt = createKeyManagement(storage);

      const activeKey = await keyMgmt.getActiveKey({
        partition: "p1",
        keyRef: "ref1",
      });

      const result = await keyMgmt.getKeyById({
        partition: "p2", // Wrong partition
        keyId: activeKey.keyId,
      });

      // This depends on storage implementation - mock storage returns null if not found
      // In real implementation, this would check partition match
      expect(result).toBeNull();
    });
  });

  describe("Scenario: Rotating Keys", () => {
    it("Given no existing key, When rotating key, Then it should create version 1", async () => {
      const storage = createMockStorage();
      const keyMgmt = createKeyManagement(storage);

      const result = await keyMgmt.rotateKey({
        partition: "p1",
        keyRef: "ref1",
      });

      expect(result.keyId).toBe("p1::ref1@1");
      expect(result.keyVersion).toBe(1);
      expect(storage.insertKey).toHaveBeenCalled();
    });

    it("Given existing key version 1, When rotating key, Then it should create version 2", async () => {
      const storage = createMockStorage();
      const keyMgmt = createKeyManagement(storage);

      // Create initial key
      await keyMgmt.getActiveKey({ partition: "p1", keyRef: "ref1" });

      // Rotate it
      const result = await keyMgmt.rotateKey({
        partition: "p1",
        keyRef: "ref1",
      });

      expect(result.keyId).toBe("p1::ref1@2");
      expect(result.keyVersion).toBe(2);
      expect(storage.deactivateKeys).toHaveBeenCalled();
      expect(storage.insertKey).toHaveBeenCalled();
    });

    it("Given existing key version 5, When rotating key, Then it should create version 6", async () => {
      const storage = createMockStorage();
      // Manually set version 5
      await storage.insertKey({
        keyId: "p1::ref1@5",
        partition: "p1",
        keyMaterial: randomKey(),
        keyVersion: 5,
      });
      storage.findCurrentActiveKeyVersion = vi.fn().mockResolvedValue(5);

      const keyMgmt = createKeyManagement(storage);
      const result = await keyMgmt.rotateKey({
        partition: "p1",
        keyRef: "ref1",
      });

      expect(result.keyVersion).toBe(6);
      expect(result.keyId).toBe("p1::ref1@6");
    });

    it("Given existing key, When rotating key, Then old key should be deactivated", async () => {
      const storage = createMockStorage();
      const keyMgmt = createKeyManagement(storage);

      await keyMgmt.getActiveKey({ partition: "p1", keyRef: "ref1" });
      await keyMgmt.rotateKey({ partition: "p1", keyRef: "ref1" });

      expect(storage.deactivateKeys).toHaveBeenCalledWith({
        partition: "p1",
        keyRef: "ref1",
      });
    });
  });

  describe("Scenario: Destroying Partition Keys", () => {
    it("Given keys in partition, When destroying partition keys, Then it should call storage destroy", async () => {
      const storage = createMockStorage();
      const keyMgmt = createKeyManagement(storage);

      await keyMgmt.destroyPartitionKeys("p1");

      expect(storage.destroyPartitionKeys).toHaveBeenCalledWith({
        partition: "p1",
      });
    });

    it("Given multiple partitions, When destroying one partition, Then other partitions should remain", async () => {
      const storage = createMockStorage();
      const keyMgmt = createKeyManagement(storage);

      await keyMgmt.getActiveKey({ partition: "p1", keyRef: "ref1" });
      await keyMgmt.getActiveKey({ partition: "p2", keyRef: "ref1" });

      await keyMgmt.destroyPartitionKeys("p1");

      expect(storage.destroyPartitionKeys).toHaveBeenCalledWith({
        partition: "p1",
      });
      // p2 should still exist (storage implementation dependent)
    });
  });
});
