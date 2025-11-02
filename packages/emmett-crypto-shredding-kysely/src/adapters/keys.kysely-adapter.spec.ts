import type { Kysely } from "kysely";
import { describe, expect, it, vi } from "vitest";
import {
  createKeyManagement,
  createKeyStorage,
} from "./keys.kysely-adapter.js";

describe("Feature: Kysely Key Storage Adapter", () => {
  // Helper to create a mock Kysely database
  function createMockDb() {
    const keys = new Map<
      string,
      {
        key_id: string;
        partition: string;
        key_version: number;
        key_material: Buffer;
        is_active: boolean;
        destroyed_at: Date | null;
      }
    >();

    let currentWhereConditions: Array<{
      column: string;
      value: any;
      op: string;
    }> = [];

    const mockExecuteTakeFirst = vi.fn(async () => {
      const conditions = [...currentWhereConditions];
      currentWhereConditions = [];

      const partition = conditions.find((c) => c.column === "partition")?.value;
      const keyIdCondition = conditions.find((c) => c.column === "key_id");
      const isActive = conditions.find((c) => c.column === "is_active")?.value;
      const destroyedAt = conditions.find(
        (c) => c.column === "destroyed_at",
      )?.value;

      if (keyIdCondition && partition) {
        const keyIdValue = keyIdCondition.value;
        const op = keyIdCondition.op;

        if (op === "=") {
          // Exact match
          const key = Array.from(keys.values()).find(
            (k) => k.key_id === keyIdValue && k.partition === partition,
          );
          if (
            key &&
            (!destroyedAt ||
              (destroyedAt === null && key.destroyed_at === null))
          ) {
            return key;
          }
        } else if (op === "like") {
          // Pattern match
          const pattern = keyIdValue.replace(/%/g, ".*").replace(/\_/g, ".");
          const regex = new RegExp(`^${pattern}$`);

          const matchingKeys = Array.from(keys.values())
            .filter((k) => {
              if (k.partition !== partition) return false;
              if (isActive !== undefined && k.is_active !== isActive)
                return false;
              if (destroyedAt === null && k.destroyed_at !== null) return false;
              return regex.test(k.key_id);
            })
            .sort((a, b) => b.key_version - a.key_version);

          return matchingKeys[0] || null;
        }
      }

      return null;
    });

    const mockExecute = vi.fn(async () => {
      const conditions = [...currentWhereConditions];
      currentWhereConditions = [];

      const values = mockValues.mock.calls[0]?.[0];
      const setValues = mockSet.mock.calls[0]?.[0];

      if (values) {
        // Insert
        const policiesToInsert = Array.isArray(values) ? values : [values];
        for (const key of policiesToInsert) {
          keys.set(key.key_id, {
            key_id: key.key_id,
            partition: key.partition,
            key_version: key.key_version,
            key_material: key.key_material,
            is_active: key.is_active ?? true,
            destroyed_at: key.destroyed_at ?? null,
          });
        }
      } else if (setValues) {
        // Update
        const partition = conditions.find(
          (c) => c.column === "partition",
        )?.value;
        const keyIdPattern = conditions.find(
          (c) => c.column === "key_id",
        )?.value;

        for (const key of keys.values()) {
          let matches = true;
          if (partition && key.partition !== partition) matches = false;
          if (
            keyIdPattern &&
            !key.key_id.match(keyIdPattern.replace(/%/g, ".*"))
          )
            matches = false;
          if (matches) {
            Object.assign(key, setValues);
          }
        }
      }
    });

    const mockWhere = vi.fn((column: string, op: string, value: any) => {
      currentWhereConditions.push({ column, value, op });
      return {
        select: mockSelect,
        where: mockWhere,
        orderBy: mockOrderBy,
        executeTakeFirst: mockExecuteTakeFirst,
        execute: mockExecute,
      };
    });

    const mockSelect = vi.fn().mockReturnThis();
    const mockOrderBy = vi.fn().mockReturnThis();
    const mockSelectFrom = vi.fn().mockReturnValue({
      select: mockSelect,
      where: mockWhere,
      orderBy: mockOrderBy,
      executeTakeFirst: mockExecuteTakeFirst,
      execute: mockExecute,
    });

    const mockValues = vi.fn().mockReturnThis();
    const mockInsertInto = vi.fn().mockReturnValue({
      values: mockValues,
      execute: mockExecute,
    });

    const mockSet = vi.fn().mockReturnThis();
    const mockUpdateTable = vi.fn().mockReturnValue({
      set: mockSet,
      where: mockWhere,
      execute: mockExecute,
    });

    return {
      db: {
        selectFrom: mockSelectFrom,
        insertInto: mockInsertInto,
        updateTable: mockUpdateTable,
      } as any as Kysely<any>,
      keys,
      mocks: {
        mockSelectFrom,
        mockInsertInto,
        mockUpdateTable,
        mockExecuteTakeFirst,
        mockExecute,
        mockValues,
        mockSet,
      },
    };
  }

  describe("Scenario: Creating Key Management", () => {
    it("Given a Kysely database, When creating key management, Then it should return KeyManagement interface", () => {
      const { db } = createMockDb();
      const keyManagement = createKeyManagement(db);

      expect(keyManagement).toBeDefined();
      expect(typeof keyManagement.getActiveKey).toBe("function");
      expect(typeof keyManagement.getKeyById).toBe("function");
      expect(typeof keyManagement.rotateKey).toBe("function");
      expect(typeof keyManagement.destroyPartitionKeys).toBe("function");
    });

    it("Given a Kysely database, When creating key storage, Then it should return KeyStorage interface", () => {
      const { db } = createMockDb();
      const keyStorage = createKeyStorage(db);

      expect(keyStorage).toBeDefined();
      expect(typeof keyStorage.findActiveKey).toBe("function");
      expect(typeof keyStorage.findKeyById).toBe("function");
      expect(typeof keyStorage.insertKey).toBe("function");
    });
  });

  describe("Scenario: Finding Active Key", () => {
    it("Given no existing key, When finding active key, Then it should return null", async () => {
      const { db } = createMockDb();
      const keyStorage = createKeyStorage(db);

      const result = await keyStorage.findActiveKey({
        partition: "p1",
        keyRef: "ref1",
      });

      expect(result).toBeNull();
    });

    it("Given existing active key, When finding active key, Then it should return the key", async () => {
      const { db, keys } = createMockDb();
      const keyId = "p1::ref1@1";

      // Pre-populate key
      keys.set(keyId, {
        key_id: keyId,
        partition: "p1",
        key_version: 1,
        key_material: Buffer.from([1, 2, 3, 4]),
        is_active: true,
        destroyed_at: null,
      });

      const keyStorage = createKeyStorage(db);

      const result = await keyStorage.findActiveKey({
        partition: "p1",
        keyRef: "ref1",
      });

      expect(result).not.toBeNull();
      if (result) {
        expect(result.keyId).toBe(keyId);
        expect(result.keyVersion).toBe(1);
        expect(result.keyMaterial).toBeInstanceOf(Uint8Array);
      }
    });

    it("Given multiple key versions, When finding active key, Then it should return the latest version", async () => {
      const { db, keys } = createMockDb();
      keys.set("p1::ref1@1", {
        key_id: "p1::ref1@1",
        partition: "p1",
        key_version: 1,
        key_material: Buffer.from([1, 2, 3, 4]),
        is_active: true,
        destroyed_at: null,
      });
      keys.set("p1::ref1@2", {
        key_id: "p1::ref1@2",
        partition: "p1",
        key_version: 2,
        key_material: Buffer.from([5, 6, 7, 8]),
        is_active: true,
        destroyed_at: null,
      });

      const keyStorage = createKeyStorage(db);

      const result = await keyStorage.findActiveKey({
        partition: "p1",
        keyRef: "ref1",
      });

      expect(result?.keyVersion).toBe(2);
    });

    it("Given destroyed key, When finding active key, Then it should return null", async () => {
      const { db, keys } = createMockDb();
      keys.set("p1::ref1@1", {
        key_id: "p1::ref1@1",
        partition: "p1",
        key_version: 1,
        key_material: Buffer.from([1, 2, 3, 4]),
        is_active: true,
        destroyed_at: new Date(), // Destroyed
      });

      const keyStorage = createKeyStorage(db);

      const result = await keyStorage.findActiveKey({
        partition: "p1",
        keyRef: "ref1",
      });

      expect(result).toBeNull();
    });
  });

  describe("Scenario: Finding Key By ID", () => {
    it("Given existing key, When finding by key ID, Then it should return the key", async () => {
      const { db, keys } = createMockDb();
      const keyId = "p1::ref1@1";
      keys.set(keyId, {
        key_id: keyId,
        partition: "p1",
        key_version: 1,
        key_material: Buffer.from([1, 2, 3, 4]),
        is_active: true,
        destroyed_at: null,
      });

      const keyStorage = createKeyStorage(db);

      const result = await keyStorage.findKeyById({
        partition: "p1",
        keyId,
      });

      expect(result).not.toBeNull();
      expect(result?.keyId).toBe(keyId);
    });

    it("Given non-existent key, When finding by key ID, Then it should return null", async () => {
      const { db } = createMockDb();
      const keyStorage = createKeyStorage(db);

      const result = await keyStorage.findKeyById({
        partition: "p1",
        keyId: "non-existent",
      });

      expect(result).toBeNull();
    });
  });

  describe("Scenario: Inserting Keys", () => {
    it("Given key data, When inserting key, Then it should store the key", async () => {
      const { db, mocks } = createMockDb();
      const keyStorage = createKeyStorage(db);

      await keyStorage.insertKey({
        keyId: "p1::ref1@1",
        partition: "p1",
        keyMaterial: new Uint8Array([1, 2, 3, 4]),
        keyVersion: 1,
      });

      expect(mocks.mockInsertInto).toHaveBeenCalledWith("encryption_keys");
      expect(mocks.mockExecute).toHaveBeenCalled();
    });
  });

  describe("Scenario: Deactivating Keys", () => {
    it("Given partition and keyRef, When deactivating keys, Then it should update keys to inactive", async () => {
      const { db, mocks } = createMockDb();
      const keyStorage = createKeyStorage(db);

      await keyStorage.deactivateKeys({
        partition: "p1",
        keyRef: "ref1",
      });

      expect(mocks.mockUpdateTable).toHaveBeenCalledWith("encryption_keys");
      expect(mocks.mockExecute).toHaveBeenCalled();
    });
  });

  describe("Scenario: Destroying Partition Keys", () => {
    it("Given partition, When destroying partition keys, Then it should set destroyed_at timestamp", async () => {
      const { db, mocks } = createMockDb();
      const keyStorage = createKeyStorage(db);

      await keyStorage.destroyPartitionKeys({
        partition: "p1",
      });

      expect(mocks.mockUpdateTable).toHaveBeenCalledWith("encryption_keys");
      expect(mocks.mockExecute).toHaveBeenCalled();
    });
  });

  describe("Scenario: Key Management Integration", () => {
    it("Given key management, When calling getActiveKey, Then it should return KeyManagement interface methods", () => {
      const { db } = createMockDb();
      const keyManagement = createKeyManagement(db);

      expect(keyManagement).toBeDefined();
      expect(typeof keyManagement.getActiveKey).toBe("function");
      expect(typeof keyManagement.rotateKey).toBe("function");
      expect(typeof keyManagement.destroyPartitionKeys).toBe("function");
    });
  });
});
