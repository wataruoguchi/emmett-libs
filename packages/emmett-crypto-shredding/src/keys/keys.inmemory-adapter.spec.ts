import { describe, expect, it } from "vitest";
import { createInMemoryKeys } from "./keys.inmemory-adapter.js";

describe("Feature: In-Memory Key Management", () => {
  // Helper functions
  function createKeys() {
    return createInMemoryKeys();
  }

  describe("Scenario: Creating In-Memory Keys", () => {
    it("Given no parameters, When creating in-memory keys, Then it should return KeyManagement interface", () => {
      const keys = createKeys();

      expect(keys).toBeDefined();
      expect(typeof keys.getActiveKey).toBe("function");
      expect(typeof keys.getKeyById).toBe("function");
      expect(typeof keys.rotateKey).toBe("function");
      expect(typeof keys.destroyPartitionKeys).toBe("function");
    });
  });

  describe("Scenario: Getting Active Key", () => {
    it("Given no existing key, When getting active key, Then it should create and return new key", async () => {
      const keys = createKeys();

      const result = await keys.getActiveKey({
        partition: "p1",
        keyRef: "ref1",
      });

      expect(result.keyId).toBe("p1::ref1@1");
      expect(result.keyVersion).toBe(1);
      expect(result.keyBytes).toBeInstanceOf(Uint8Array);
      expect(result.keyBytes.length).toBe(32);
    });

    it("Given existing key, When getting active key, Then it should return same key", async () => {
      const keys = createKeys();

      const first = await keys.getActiveKey({
        partition: "p1",
        keyRef: "ref1",
      });
      const second = await keys.getActiveKey({
        partition: "p1",
        keyRef: "ref1",
      });

      expect(second.keyId).toBe(first.keyId);
      expect(second.keyVersion).toBe(first.keyVersion);
      expect(second.keyBytes).toEqual(first.keyBytes);
    });

    it("Given different partitions, When getting active keys, Then each should have separate keys", async () => {
      const keys = createKeys();

      const key1 = await keys.getActiveKey({ partition: "p1", keyRef: "ref1" });
      const key2 = await keys.getActiveKey({ partition: "p2", keyRef: "ref1" });

      expect(key1.keyId).not.toBe(key2.keyId);
      expect(key1.keyBytes).not.toEqual(key2.keyBytes);
    });

    it("Given different keyRefs, When getting active keys, Then each should have separate keys", async () => {
      const keys = createKeys();

      const key1 = await keys.getActiveKey({ partition: "p1", keyRef: "ref1" });
      const key2 = await keys.getActiveKey({ partition: "p1", keyRef: "ref2" });

      expect(key1.keyId).not.toBe(key2.keyId);
      expect(key1.keyBytes).not.toEqual(key2.keyBytes);
    });
  });

  describe("Scenario: Getting Key By ID", () => {
    it("Given existing key ID, When getting key by ID, Then it should return key", async () => {
      const keys = createKeys();

      const activeKey = await keys.getActiveKey({
        partition: "p1",
        keyRef: "ref1",
      });
      const result = await keys.getKeyById({
        partition: "p1",
        keyId: activeKey.keyId,
      });

      expect(result).not.toBeNull();
      expect(result!.keyId).toBe(activeKey.keyId);
      expect(result!.keyVersion).toBe(activeKey.keyVersion);
      expect(result!.keyBytes).toEqual(activeKey.keyBytes);
    });

    it("Given non-existent key ID, When getting key by ID, Then it should return null", async () => {
      const keys = createKeys();

      const result = await keys.getKeyById({
        partition: "p1",
        keyId: "p1::nonexistent@1",
      });

      expect(result).toBeNull();
    });

    it("Given invalid key ID format, When getting key by ID, Then it should return null", async () => {
      const keys = createKeys();

      const result = await keys.getKeyById({
        partition: "p1",
        keyId: "invalid-format",
      });

      expect(result).toBeNull();
    });

    it("Given wrong partition in key ID, When getting key by ID, Then it should return null", async () => {
      const keys = createKeys();

      const result = await keys.getKeyById({
        partition: "p1",
        keyId: "p2::ref1@1", // Wrong partition
      });

      expect(result).toBeNull();
    });

    it("Given key ID with non-matching version, When getting key by ID, Then it should return null", async () => {
      const keys = createKeys();

      await keys.getActiveKey({ partition: "p1", keyRef: "ref1" });

      const result = await keys.getKeyById({
        partition: "p1",
        keyId: "p1::ref1@999", // Non-existent version
      });

      expect(result).toBeNull();
    });
  });

  describe("Scenario: Rotating Keys", () => {
    it("Given no existing key, When rotating key, Then it should create version 1", async () => {
      const keys = createKeys();

      const result = await keys.rotateKey({ partition: "p1", keyRef: "ref1" });

      expect(result.keyId).toBe("p1::ref1@1");
      expect(result.keyVersion).toBe(1);
    });

    it("Given existing key version 1, When rotating key, Then it should create version 2", async () => {
      const keys = createKeys();

      await keys.getActiveKey({ partition: "p1", keyRef: "ref1" });
      const result = await keys.rotateKey({ partition: "p1", keyRef: "ref1" });

      expect(result.keyId).toBe("p1::ref1@2");
      expect(result.keyVersion).toBe(2);
    });

    it("Given multiple rotations, When rotating key, Then version should increment", async () => {
      const keys = createKeys();

      const result1 = await keys.rotateKey({ partition: "p1", keyRef: "ref1" });
      const result2 = await keys.rotateKey({ partition: "p1", keyRef: "ref1" });
      const result3 = await keys.rotateKey({ partition: "p1", keyRef: "ref1" });

      expect(result1.keyVersion).toBe(1);
      expect(result2.keyVersion).toBe(2);
      expect(result3.keyVersion).toBe(3);
    });

    it("Given rotated key, When getting active key, Then it should return new key", async () => {
      const keys = createKeys();

      const original = await keys.getActiveKey({
        partition: "p1",
        keyRef: "ref1",
      });
      await keys.rotateKey({ partition: "p1", keyRef: "ref1" });
      const active = await keys.getActiveKey({
        partition: "p1",
        keyRef: "ref1",
      });

      expect(active.keyVersion).toBe(2);
      expect(active.keyId).not.toBe(original.keyId);
    });
  });

  describe("Scenario: Destroying Partition Keys", () => {
    it("Given keys in partition, When destroying partition keys, Then keys should be removed", async () => {
      const keys = createKeys();

      const key1 = await keys.getActiveKey({ partition: "p1", keyRef: "ref1" });
      const key2 = await keys.getActiveKey({ partition: "p1", keyRef: "ref2" });

      await keys.destroyPartitionKeys("p1");

      const result1 = await keys.getKeyById({
        partition: "p1",
        keyId: key1.keyId,
      });
      const result2 = await keys.getKeyById({
        partition: "p1",
        keyId: key2.keyId,
      });

      expect(result1).toBeNull();
      expect(result2).toBeNull();
    });

    it("Given multiple partitions, When destroying one partition, Then other partitions should remain", async () => {
      const keys = createKeys();

      const key1 = await keys.getActiveKey({ partition: "p1", keyRef: "ref1" });
      const key2 = await keys.getActiveKey({ partition: "p2", keyRef: "ref1" });

      await keys.destroyPartitionKeys("p1");

      const result1 = await keys.getKeyById({
        partition: "p1",
        keyId: key1.keyId,
      });
      const result2 = await keys.getKeyById({
        partition: "p2",
        keyId: key2.keyId,
      });

      expect(result1).toBeNull();
      expect(result2).not.toBeNull();
    });

    it("Given destroyed keys, When getting active key, Then it should create new key", async () => {
      const keys = createKeys();

      const original = await keys.getActiveKey({
        partition: "p1",
        keyRef: "ref1",
      });
      await keys.destroyPartitionKeys("p1");

      // After destroying, the key should be gone, so getting active key creates a new one
      // Note: In the in-memory adapter, destroyPartitionKeys clears the store entry
      // but getActiveKey will recreate it, so we get a new key with version 1
      const newKey = await keys.getActiveKey({
        partition: "p1",
        keyRef: "ref1",
      });

      // The key material should be different (new random key generated)
      expect(newKey.keyBytes).not.toEqual(original.keyBytes);
      expect(newKey.keyVersion).toBe(1); // Starts fresh
    });
  });

  describe("Scenario: Key Isolation", () => {
    it("Given same keyRef in different partitions, When managing keys, Then they should be independent", async () => {
      const keys = createKeys();

      const key1 = await keys.getActiveKey({
        partition: "p1",
        keyRef: "same-ref",
      });
      const key2 = await keys.getActiveKey({
        partition: "p2",
        keyRef: "same-ref",
      });

      expect(key1.keyId).not.toBe(key2.keyId);
      expect(key1.keyBytes).not.toEqual(key2.keyBytes);

      await keys.destroyPartitionKeys("p1");

      const key1AfterDestroy = await keys.getKeyById({
        partition: "p1",
        keyId: key1.keyId,
      });
      const key2AfterDestroy = await keys.getKeyById({
        partition: "p2",
        keyId: key2.keyId,
      });

      expect(key1AfterDestroy).toBeNull();
      expect(key2AfterDestroy).not.toBeNull();
    });
  });
});
