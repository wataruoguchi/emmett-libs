import { describe, expect, it, vi } from "vitest";
import { PolicyResolutionError } from "../errors.js";
import {
  createPolicyResolver,
  type PolicyData,
  type PolicyStorage,
} from "./policy.resolver.js";

describe("Feature: Policy Resolver", () => {
  // Helper functions
  function createMockStorage(
    policies: Map<string, PolicyData> = new Map(),
  ): PolicyStorage {
    return {
      findPolicy: vi.fn(async ({ partition, streamType }) => {
        // When streamType is null/undefined, we look up with "null" as the key
        const key = `${partition}:${streamType ?? null}`;
        return policies.get(key) ?? null;
      }),
    };
  }

  function createMockPolicy(overrides?: Partial<PolicyData>): PolicyData {
    return {
      encryptionAlgorithm: "AES-GCM",
      keyRotationIntervalDays: 90,
      streamTypeClass: "test-type",
      keyScope: "type",
      ...overrides,
    };
  }

  describe("Scenario: Policy Resolution", () => {
    it("Given no policy exists, When resolving policy, Then it should return no encryption", async () => {
      const storage = createMockStorage();
      const resolver = createPolicyResolver(storage);

      const result = await resolver.resolve({
        partition: "p1",
        streamId: "stream-1",
        streamType: "unknown",
      });

      expect(result.encrypt).toBe(false);
    });

    it("Given policy exists, When resolving policy, Then it should return encryption config", async () => {
      const policies = new Map<string, PolicyData>();
      policies.set("p1:test-type", createMockPolicy());
      const storage = createMockStorage(policies);
      const resolver = createPolicyResolver(storage);

      const result = await resolver.resolve({
        partition: "p1",
        streamId: "stream-1",
        streamType: "test-type",
      });

      expect(result.encrypt).toBe(true);
      if (result.encrypt) {
        expect(result.algo).toBe("AES-GCM");
        expect(result.keyRef).toBe("test-type");
      }
    });

    it("Given policy with custom algorithm, When resolving policy, Then it should use custom algorithm", async () => {
      const policies = new Map<string, PolicyData>();
      policies.set(
        "p1:test-type",
        createMockPolicy({ encryptionAlgorithm: "AES-CBC" }),
      );
      const storage = createMockStorage(policies);
      const resolver = createPolicyResolver(storage);

      const result = await resolver.resolve({
        partition: "p1",
        streamId: "stream-1",
        streamType: "test-type",
      });

      expect(result.encrypt).toBe(true);
      if (result.encrypt) {
        expect(result.algo).toBe("AES-CBC");
      }
    });

    it("Given policy with null algorithm, When resolving policy, Then it should default to AES-GCM", async () => {
      const policies = new Map<string, PolicyData>();
      policies.set(
        "p1:test-type",
        createMockPolicy({ encryptionAlgorithm: null }),
      );
      const storage = createMockStorage(policies);
      const resolver = createPolicyResolver(storage);

      const result = await resolver.resolve({
        partition: "p1",
        streamId: "stream-1",
        streamType: "test-type",
      });

      expect(result.encrypt).toBe(true);
      if (result.encrypt) {
        expect(result.algo).toBe("AES-GCM");
      }
    });
  });

  describe("Scenario: Key Scope - Stream", () => {
    it("Given stream-scoped policy with streamId, When resolving policy, Then it should use streamId as keyRef", async () => {
      const policies = new Map<string, PolicyData>();
      policies.set("p1:test-type", createMockPolicy({ keyScope: "stream" }));
      const storage = createMockStorage(policies);
      const resolver = createPolicyResolver(storage);

      const result = await resolver.resolve({
        partition: "p1",
        streamId: "specific-stream-id",
        streamType: "test-type",
      });

      expect(result.encrypt).toBe(true);
      if (result.encrypt) {
        expect(result.keyRef).toBe("specific-stream-id");
      }
    });

    it("Given stream-scoped policy without streamId, When resolving policy, Then it should throw PolicyResolutionError", async () => {
      const policies = new Map<string, PolicyData>();
      policies.set("p1:test-type", createMockPolicy({ keyScope: "stream" }));
      const storage = createMockStorage(policies);
      const resolver = createPolicyResolver(storage);

      await expect(
        resolver.resolve({
          partition: "p1",
          streamId: "", // Empty streamId
          streamType: "test-type",
        }),
      ).rejects.toThrow(PolicyResolutionError);
    });
  });

  describe("Scenario: Key Scope - Type", () => {
    it("Given type-scoped policy with streamType, When resolving policy, Then it should use streamType as keyRef", async () => {
      const policies = new Map<string, PolicyData>();
      policies.set(
        "p1:user-data",
        createMockPolicy({ keyScope: "type", streamTypeClass: "user-data" }),
      );
      const storage = createMockStorage(policies);
      const resolver = createPolicyResolver(storage);

      const result = await resolver.resolve({
        partition: "p1",
        streamId: "stream-1",
        streamType: "user-data",
      });

      expect(result.encrypt).toBe(true);
      if (result.encrypt) {
        expect(result.keyRef).toBe("user-data");
      }
    });

    it("Given type-scoped policy without streamType, When resolving policy, Then it should throw PolicyResolutionError", async () => {
      const policies = new Map<string, PolicyData>();
      // Store policy under null streamType (which matches when streamType is undefined)
      policies.set(
        "p1:null",
        createMockPolicy({ keyScope: "type", streamTypeClass: "test-type" }),
      );
      const storage = createMockStorage(policies);
      const resolver = createPolicyResolver(storage);

      await expect(
        resolver.resolve({
          partition: "p1",
          streamId: "stream-1",
          streamType: undefined, // Missing streamType
        }),
      ).rejects.toThrow(PolicyResolutionError);
    });

    it("Given type-scoped policy with null keyScope, When resolving policy, Then it should default to type scope", async () => {
      const policies = new Map<string, PolicyData>();
      policies.set("p1:test-type", createMockPolicy({ keyScope: null }));
      const storage = createMockStorage(policies);
      const resolver = createPolicyResolver(storage);

      const result = await resolver.resolve({
        partition: "p1",
        streamId: "stream-1",
        streamType: "test-type",
      });

      expect(result.encrypt).toBe(true);
      if (result.encrypt) {
        expect(result.keyRef).toBe("test-type");
      }
    });
  });

  describe("Scenario: Key Scope - Partition", () => {
    it("Given partition-scoped policy, When resolving policy, Then it should use 'default' as keyRef", async () => {
      const policies = new Map<string, PolicyData>();
      policies.set("p1:test-type", createMockPolicy({ keyScope: "partition" }));
      const storage = createMockStorage(policies);
      const resolver = createPolicyResolver(storage);

      const result = await resolver.resolve({
        partition: "p1",
        streamId: "stream-1",
        streamType: "test-type",
      });

      expect(result.encrypt).toBe(true);
      if (result.encrypt) {
        expect(result.keyRef).toBe("default");
      }
    });

    it("Given partition-scoped policy, When resolving without streamType, Then it should still use 'default'", async () => {
      const policies = new Map<string, PolicyData>();
      // When streamType is undefined, storage receives null
      policies.set(
        "p1:null",
        createMockPolicy({ keyScope: "partition", streamTypeClass: "default" }),
      );
      const storage = createMockStorage(policies);
      const resolver = createPolicyResolver(storage);

      const result = await resolver.resolve({
        partition: "p1",
        streamId: "stream-1",
        streamType: undefined,
      });

      expect(result.encrypt).toBe(true);
      if (result.encrypt) {
        expect(result.keyRef).toBe("default");
      }
    });
  });

  describe("Scenario: Error Handling", () => {
    it("Given storage throws error, When resolving policy, Then it should call onError and return no encryption", async () => {
      const storage: PolicyStorage = {
        findPolicy: vi.fn().mockRejectedValue(new Error("Storage error")),
      };
      const onError = vi.fn();
      const resolver = createPolicyResolver(storage, onError);

      const result = await resolver.resolve({
        partition: "p1",
        streamId: "stream-1",
        streamType: "test-type",
      });

      expect(result.encrypt).toBe(false);
      expect(onError).toHaveBeenCalled();
    });

    it("Given PolicyResolutionError thrown, When resolving policy, Then it should rethrow error", async () => {
      const policies = new Map<string, PolicyData>();
      policies.set("p1:test-type", createMockPolicy({ keyScope: "stream" }));
      const storage = createMockStorage(policies);
      const onError = vi.fn();
      const resolver = createPolicyResolver(storage, onError);

      await expect(
        resolver.resolve({
          partition: "p1",
          streamId: "", // Will cause PolicyResolutionError
          streamType: "test-type",
        }),
      ).rejects.toThrow(PolicyResolutionError);

      // onError should not be called for PolicyResolutionError
      expect(onError).not.toHaveBeenCalled();
    });
  });

  describe("Scenario: Policy Matching", () => {
    it("Given specific streamType policy, When resolving with matching streamType, Then it should match", async () => {
      const policies = new Map<string, PolicyData>();
      policies.set(
        "p1:user-data",
        createMockPolicy({ streamTypeClass: "user-data" }),
      );
      policies.set(
        "p1:audit-log",
        createMockPolicy({ streamTypeClass: "audit-log" }),
      );
      const storage = createMockStorage(policies);
      const resolver = createPolicyResolver(storage);

      const result = await resolver.resolve({
        partition: "p1",
        streamId: "stream-1",
        streamType: "user-data",
      });

      expect(result.encrypt).toBe(true);
    });

    it("Given default policy with partition scope, When resolving without streamType, Then it should match and use default keyRef", async () => {
      const policies = new Map<string, PolicyData>();
      policies.set(
        "p1:null",
        createMockPolicy({ streamTypeClass: "default", keyScope: "partition" }),
      );
      const storage = createMockStorage(policies);
      const resolver = createPolicyResolver(storage);

      const result = await resolver.resolve({
        partition: "p1",
        streamId: "stream-1",
        streamType: undefined,
      });

      expect(result.encrypt).toBe(true);
      if (result.encrypt) {
        expect(result.keyRef).toBe("default");
      }
    });

    it("Given different partitions, When resolving policy, Then each partition should have separate policies", async () => {
      const policies = new Map<string, PolicyData>();
      policies.set("p1:test-type", createMockPolicy());
      const storage = createMockStorage(policies);
      const resolver = createPolicyResolver(storage);

      const result1 = await resolver.resolve({
        partition: "p1",
        streamId: "stream-1",
        streamType: "test-type",
      });

      const result2 = await resolver.resolve({
        partition: "p2", // Different partition
        streamId: "stream-1",
        streamType: "test-type",
      });

      expect(result1.encrypt).toBe(true);
      expect(result2.encrypt).toBe(false); // No policy for p2
    });
  });
});
