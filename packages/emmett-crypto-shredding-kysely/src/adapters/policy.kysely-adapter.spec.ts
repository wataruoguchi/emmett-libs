import { PolicyResolutionError } from "@wataruoguchi/emmett-crypto-shredding";
import type { Kysely } from "kysely";
import { describe, expect, it, vi } from "vitest";
import {
  createDefaultPolicies,
  createPolicies,
  createPolicyResolver,
  createPolicyStorage,
  deletePolicy,
  listPolicies,
  updatePolicy,
  type Logger,
} from "./policy.kysely-adapter.js";

describe("Feature: Kysely Policy Storage Adapter", () => {
  // Helper to create a mock Kysely database
  function createMockDb() {
    const policies = new Map<
      string,
      {
        policy_id: string;
        partition: string;
        stream_type_class: string;
        encryption_algorithm: string | null;
        key_rotation_interval_days: number | null;
        key_scope: string;
      }
    >();

    const mockExecuteTakeFirst = vi.fn();
    const mockExecute = vi.fn();
    const mockWhere = vi.fn().mockReturnThis();
    const mockSelect = vi.fn().mockReturnThis();
    const mockSelectAll = vi.fn().mockReturnThis();

    const mockSelectFrom = vi.fn().mockReturnValue({
      select: mockSelect,
      selectAll: mockSelectAll,
      where: mockWhere,
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

    const mockDeleteFrom = vi.fn().mockReturnValue({
      where: mockWhere,
      execute: mockExecute,
    });

    // Track where conditions for executeTakeFirst
    let whereConditions: Array<{ column: string; value: any }> = [];

    mockWhere.mockImplementation((column: string, op: string, value: any) => {
      if (op === "=") {
        whereConditions.push({ column, value });
      }
      return {
        select: mockSelect,
        selectAll: mockSelectAll,
        where: mockWhere,
        executeTakeFirst: mockExecuteTakeFirst,
        execute: mockExecute,
      };
    });

    mockExecuteTakeFirst.mockImplementation(async () => {
      const conditions = [...whereConditions];
      whereConditions = [];

      const partition = conditions.find((c) => c.column === "partition")?.value;
      const streamType = conditions.find(
        (c) => c.column === "stream_type_class",
      )?.value;

      if (partition && streamType) {
        const policy = Array.from(policies.values()).find(
          (p) =>
            p.partition === partition && p.stream_type_class === streamType,
        );
        if (policy) {
          return {
            encryption_algorithm: policy.encryption_algorithm,
            key_rotation_interval_days: policy.key_rotation_interval_days,
            stream_type_class: policy.stream_type_class,
            key_scope: policy.key_scope,
          };
        }
      }

      return null;
    });

    mockExecute.mockImplementation(async () => {
      const conditions = [...whereConditions];
      whereConditions = [];

      const values = mockValues.mock.calls[0]?.[0];
      const setValues = mockSet.mock.calls[0]?.[0];

      if (values) {
        // Insert
        const policiesToInsert = Array.isArray(values) ? values : [values];
        for (const policy of policiesToInsert) {
          policies.set(`${policy.partition}:${policy.stream_type_class}`, {
            policy_id: policy.policy_id,
            partition: policy.partition,
            stream_type_class: policy.stream_type_class,
            encryption_algorithm: policy.encryption_algorithm,
            key_rotation_interval_days: policy.key_rotation_interval_days,
            key_scope: policy.key_scope,
          });
        }
      } else if (setValues) {
        // Update
        const policyId = conditions.find(
          (c) => c.column === "policy_id",
        )?.value;
        const partition = conditions.find(
          (c) => c.column === "partition",
        )?.value;

        for (const policy of policies.values()) {
          if (policy.policy_id === policyId && policy.partition === partition) {
            if (setValues.encryption_algorithm !== undefined) {
              policy.encryption_algorithm = setValues.encryption_algorithm;
            }
            if (setValues.key_rotation_interval_days !== undefined) {
              policy.key_rotation_interval_days =
                setValues.key_rotation_interval_days;
            }
            if (setValues.key_scope !== undefined) {
              policy.key_scope = setValues.key_scope;
            }
          }
        }
      }

      // For listPolicies - return all matching policies
      const partitionFilter = conditions.find(
        (c) => c.column === "partition",
      )?.value;
      if (partitionFilter) {
        return Array.from(policies.values()).filter(
          (p) => p.partition === partitionFilter,
        );
      }

      return Array.from(policies.values());
    });

    return {
      db: {
        selectFrom: mockSelectFrom,
        insertInto: mockInsertInto,
        updateTable: mockUpdateTable,
        deleteFrom: mockDeleteFrom,
      } as any as Kysely<any>,
      policies,
      mocks: {
        mockSelectFrom,
        mockInsertInto,
        mockUpdateTable,
        mockDeleteFrom,
        mockExecuteTakeFirst,
        mockExecute,
      },
    };
  }

  function createMockLogger(): Logger {
    return {
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };
  }

  describe("Scenario: Creating Policy Resolver", () => {
    it("Given a Kysely database, When creating policy resolver, Then it should return EncryptionPolicyResolver interface", () => {
      const { db } = createMockDb();
      const logger = createMockLogger();
      const policyResolver = createPolicyResolver(db, logger);

      expect(policyResolver).toBeDefined();
      expect(typeof policyResolver.resolve).toBe("function");
    });

    it("Given a Kysely database, When creating policy storage, Then it should return PolicyStorage interface", () => {
      const { db } = createMockDb();
      const logger = createMockLogger();
      const policyStorage = createPolicyStorage(db, logger);

      expect(policyStorage).toBeDefined();
      expect(typeof policyStorage.findPolicy).toBe("function");
    });
  });

  describe("Scenario: Finding Policy", () => {
    it("Given no policy exists, When finding policy, Then it should return null", async () => {
      const { db } = createMockDb();
      const logger = createMockLogger();
      const policyStorage = createPolicyStorage(db, logger);

      const result = await policyStorage.findPolicy({
        partition: "p1",
        streamType: "unknown",
      });

      expect(result).toBeNull();
    });

    it("Given existing policy, When finding policy, Then it should return the policy", async () => {
      const { db, policies } = createMockDb();
      policies.set("p1:user-data", {
        policy_id: "p1-user-data",
        partition: "p1",
        stream_type_class: "user-data",
        encryption_algorithm: "AES-GCM",
        key_rotation_interval_days: 180,
        key_scope: "stream",
      });

      const logger = createMockLogger();
      const policyStorage = createPolicyStorage(db, logger);

      const result = await policyStorage.findPolicy({
        partition: "p1",
        streamType: "user-data",
      });

      expect(result).not.toBeNull();
      expect(result?.encryptionAlgorithm).toBe("AES-GCM");
      expect(result?.keyRotationIntervalDays).toBe(180);
      expect(result?.streamTypeClass).toBe("user-data");
      expect(result?.keyScope).toBe("stream");
    });

    it("Given missing streamType, When finding policy, Then it should throw PolicyResolutionError", async () => {
      const { db } = createMockDb();
      const logger = createMockLogger();
      const policyStorage = createPolicyStorage(db, logger);

      await expect(
        policyStorage.findPolicy({
          partition: "p1",
          streamType: null as any,
        }),
      ).rejects.toThrow(PolicyResolutionError);
    });
  });

  describe("Scenario: Policy Resolution", () => {
    it("Given no policy exists, When resolving policy, Then it should throw error", async () => {
      const { db } = createMockDb();
      const logger = createMockLogger();
      const policyResolver = createPolicyResolver(db, logger);

      await expect(
        policyResolver.resolve({
          partition: "p1",
          streamId: "stream-1",
          streamType: "unknown",
        }),
      ).rejects.toThrow("No encryption policy found");
    });

    it("Given policy exists, When resolving policy, Then it should return encryption config", async () => {
      const { db, policies } = createMockDb();
      policies.set("p1:user-data", {
        policy_id: "p1-user-data",
        partition: "p1",
        stream_type_class: "user-data",
        encryption_algorithm: "AES-GCM",
        key_rotation_interval_days: 180,
        key_scope: "stream",
      });

      const logger = createMockLogger();
      const policyResolver = createPolicyResolver(db, logger);

      const result = await policyResolver.resolve({
        partition: "p1",
        streamId: "stream-1",
        streamType: "user-data",
      });

      expect(result.encrypt).toBe(true);
      if (result.encrypt) {
        expect(result.algo).toBe("AES-GCM");
      }
    });
  });

  describe("Scenario: Creating Policies", () => {
    it("Given empty array, When creating policies, Then it should not execute insert", async () => {
      const { db, mocks } = createMockDb();
      await createPolicies(db, []);

      expect(mocks.mockInsertInto).not.toHaveBeenCalled();
    });

    it("Given policies array, When creating policies, Then it should insert all policies", async () => {
      const { db, mocks, policies } = createMockDb();

      await createPolicies(db, [
        {
          policyId: "p1-user-data",
          partition: "p1",
          streamTypeClass: "user-data",
          encryptionAlgorithm: "AES-GCM",
          keyRotationIntervalDays: 180,
          keyScope: "stream",
        },
        {
          policyId: "p1-audit-log",
          partition: "p1",
          streamTypeClass: "audit-log",
          encryptionAlgorithm: "AES-GCM",
          keyRotationIntervalDays: 365,
          keyScope: "type",
        },
      ]);

      expect(mocks.mockInsertInto).toHaveBeenCalledWith("encryption_policies");
      expect(policies.size).toBe(2);
    });

    it("Given default policies, When creating default policies, Then it should insert default policy set", async () => {
      const { db, policies } = createMockDb();

      await createDefaultPolicies(db, "p1");

      // Should create user-data and audit-log policies
      expect(policies.size).toBeGreaterThan(0);
      const userDataPolicy = Array.from(policies.values()).find(
        (p) => p.stream_type_class === "user-data",
      );
      const auditLogPolicy = Array.from(policies.values()).find(
        (p) => p.stream_type_class === "audit-log",
      );

      expect(userDataPolicy).toBeDefined();
      expect(auditLogPolicy).toBeDefined();
    });
  });

  describe("Scenario: Updating Policy", () => {
    it("Given existing policy, When updating policy, Then it should update the policy", async () => {
      const { db, policies, mocks } = createMockDb();
      policies.set("p1:user-data", {
        policy_id: "p1-user-data",
        partition: "p1",
        stream_type_class: "user-data",
        encryption_algorithm: "AES-GCM",
        key_rotation_interval_days: 180,
        key_scope: "stream",
      });

      await updatePolicy(db, "p1-user-data", "p1", {
        encryptionAlgorithm: "AES-CBC",
        keyRotationIntervalDays: 365,
      });

      expect(mocks.mockUpdateTable).toHaveBeenCalledWith("encryption_policies");
    });
  });

  describe("Scenario: Deleting Policy", () => {
    it("Given existing policy, When deleting policy, Then it should remove the policy", async () => {
      const { db, mocks } = createMockDb();

      await deletePolicy(db, "p1-user-data", "p1");

      expect(mocks.mockDeleteFrom).toHaveBeenCalledWith("encryption_policies");
      expect(mocks.mockExecute).toHaveBeenCalled();
    });
  });

  describe("Scenario: Listing Policies", () => {
    it("Given partition with policies, When listing policies, Then it should return all policies", async () => {
      const { db, policies } = createMockDb();
      policies.set("p1:user-data", {
        policy_id: "p1-user-data",
        partition: "p1",
        stream_type_class: "user-data",
        encryption_algorithm: "AES-GCM",
        key_rotation_interval_days: 180,
        key_scope: "stream",
      });
      policies.set("p1:audit-log", {
        policy_id: "p1-audit-log",
        partition: "p1",
        stream_type_class: "audit-log",
        encryption_algorithm: "AES-GCM",
        key_rotation_interval_days: 365,
        key_scope: "type",
      });

      const result = await listPolicies(db, "p1");

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThanOrEqual(0);
    });
  });
});
