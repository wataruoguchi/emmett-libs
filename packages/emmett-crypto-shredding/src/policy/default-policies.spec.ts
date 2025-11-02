import { describe, expect, it } from "vitest";
import { getDefaultPolicies } from "../index.js";
import type { PolicyConfig } from "./default-policies.js";

describe("Feature: Default Policies", () => {
  // Helper functions
  function getPolicyById(policies: PolicyConfig[], policyId: string) {
    return policies.find((p) => p.policyId === policyId);
  }

  describe("Scenario: Getting Default Policies", () => {
    it("Given a partition, When getting default policies, Then it should return policies with partition-prefixed ids", () => {
      const partition = "tenant-xyz";
      const policies = getDefaultPolicies(partition);

      expect(policies.length).toBeGreaterThan(0);
      for (const p of policies) {
        expect(p.policyId.startsWith(partition + "-")).toBe(true);
        expect(typeof p.streamTypeClass).toBe("string");
        expect(typeof p.keyScope).toBe("string");
        expect(["stream", "type", "tenant"]).toContain(p.keyScope);
        expect(["AES-GCM", "AES-CBC", "AES-CTR"]).toContain(
          p.encryptionAlgorithm,
        );
        expect(typeof p.keyRotationIntervalDays).toBe("number");
      }
    });

    it("Given a partition, When getting default policies, Then it should include user-data and audit-log defaults", () => {
      const policies = getDefaultPolicies("p");
      const types = new Set(policies.map((p) => p.streamTypeClass));

      expect(types.has("user-data")).toBe(true);
      expect(types.has("audit-log")).toBe(true);
    });

    it("Given default policies, When checking policy configuration, Then user-data should be stream-scoped", () => {
      const policies = getDefaultPolicies("tenant-1");
      const userDataPolicy = getPolicyById(policies, "tenant-1-user-data");

      expect(userDataPolicy).toBeDefined();
      expect(userDataPolicy!.keyScope).toBe("stream");
      expect(userDataPolicy!.encryptionAlgorithm).toBe("AES-GCM");
      expect(userDataPolicy!.keyRotationIntervalDays).toBe(180);
    });

    it("Given default policies, When checking policy configuration, Then audit-log should be stream-scoped", () => {
      const policies = getDefaultPolicies("tenant-1");
      const auditLogPolicy = getPolicyById(policies, "tenant-1-audit-log");

      expect(auditLogPolicy).toBeDefined();
      expect(auditLogPolicy!.keyScope).toBe("stream");
      expect(auditLogPolicy!.encryptionAlgorithm).toBe("AES-GCM");
      expect(auditLogPolicy!.keyRotationIntervalDays).toBe(365);
    });
  });

  describe("Scenario: Custom Policies", () => {
    it("Given custom policies, When getting default policies, Then it should include custom policies", () => {
      const partition = "tenant-1";
      const customPolicies: Partial<PolicyConfig>[] = [
        {
          streamTypeClass: "custom-type",
          encryptionAlgorithm: "AES-CBC",
          keyRotationIntervalDays: 30,
          keyScope: "type",
        },
      ];

      const policies = getDefaultPolicies(partition, customPolicies);

      expect(policies.length).toBeGreaterThan(2); // Defaults + custom
      const customPolicy = policies.find(
        (p) => p.streamTypeClass === "custom-type",
      );

      expect(customPolicy).toBeDefined();
      expect(customPolicy!.policyId).toBe("tenant-1-custom-type-custom");
      expect(customPolicy!.encryptionAlgorithm).toBe("AES-CBC");
      expect(customPolicy!.keyRotationIntervalDays).toBe(30);
      expect(customPolicy!.keyScope).toBe("type");
    });

    it("Given custom policy with policyId, When getting default policies, Then it should use provided policyId", () => {
      const partition = "tenant-1";
      const customPolicies: Partial<PolicyConfig>[] = [
        {
          policyId: "my-custom-policy-id",
          streamTypeClass: "custom-type",
          encryptionAlgorithm: "AES-GCM",
          keyRotationIntervalDays: 60,
          keyScope: "tenant",
        },
      ];

      const policies = getDefaultPolicies(partition, customPolicies);
      const customPolicy = policies.find(
        (p) => p.policyId === "my-custom-policy-id",
      );

      expect(customPolicy).toBeDefined();
      expect(customPolicy!.policyId).toBe("my-custom-policy-id");
      expect(customPolicy!.streamTypeClass).toBe("custom-type");
    });

    it("Given multiple custom policies, When getting default policies, Then all should be included", () => {
      const partition = "tenant-1";
      const customPolicies: Partial<PolicyConfig>[] = [
        {
          streamTypeClass: "type-1",
          encryptionAlgorithm: "AES-GCM",
          keyRotationIntervalDays: 90,
          keyScope: "type",
        },
        {
          streamTypeClass: "type-2",
          encryptionAlgorithm: "AES-CBC",
          keyRotationIntervalDays: 120,
          keyScope: "stream",
        },
      ];

      const policies = getDefaultPolicies(partition, customPolicies);

      expect(policies.length).toBe(4); // 2 defaults + 2 custom
      expect(policies.some((p) => p.streamTypeClass === "type-1")).toBe(true);
      expect(policies.some((p) => p.streamTypeClass === "type-2")).toBe(true);
    });

    it("Given empty custom policies array, When getting default policies, Then it should return only defaults", () => {
      const partition = "tenant-1";
      const policies = getDefaultPolicies(partition, []);

      expect(policies.length).toBe(2); // Only default policies
      expect(
        policies.every((p) => p.policyId.startsWith(partition + "-")),
      ).toBe(true);
    });
  });

  describe("Scenario: Policy ID Generation", () => {
    it("Given different partitions, When getting default policies, Then policy IDs should differ", () => {
      const policies1 = getDefaultPolicies("tenant-1");
      const policies2 = getDefaultPolicies("tenant-2");

      expect(policies1[0].policyId).not.toBe(policies2[0].policyId);
      expect(policies1[0].policyId).toContain("tenant-1");
      expect(policies2[0].policyId).toContain("tenant-2");
    });
  });
});
