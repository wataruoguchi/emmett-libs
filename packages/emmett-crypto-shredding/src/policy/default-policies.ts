import type { SupportedAlgorithm } from "../types.js";

/**
 * Default encryption policy configuration
 */
export interface PolicyConfig {
  policyId: string;
  streamTypeClass: string;
  encryptionAlgorithm: SupportedAlgorithm;
  keyRotationIntervalDays: number;
  keyScope: "stream" | "type" | "partition";
  partition: string;
}

/**
 * Get default encryption policies for common stream types
 *
 * These policies provide sensible defaults for typical SaaS applications
 * and can be customized based on specific requirements.
 *
 * @param partition - The partition/tenant identifier
 * @param customPolicies - Optional custom policies to include
 * @returns Array of default policy configurations
 *
 * @example
 * ```typescript
 * import { getDefaultPolicies } from '@wataruoguchi/emmett-crypto-shredding';
 *
 * const policies = getDefaultPolicies('tenant-123');
 * // Returns policies for user-data, audit-log, etc.
 * ```
 */
export function getDefaultPolicies(
  partition: string,
  customPolicies: Partial<PolicyConfig>[] = [],
): PolicyConfig[] {
  const basePolicies: Omit<PolicyConfig, "policyId">[] = [
    {
      streamTypeClass: "user-data",
      encryptionAlgorithm: "AES-GCM",
      keyRotationIntervalDays: 180,
      keyScope: "stream",
      partition,
    },
    {
      streamTypeClass: "audit-log",
      encryptionAlgorithm: "AES-GCM",
      keyRotationIntervalDays: 365,
      keyScope: "stream",
      partition,
    },
  ];

  // Generate policies with partition-specific IDs
  const policies: PolicyConfig[] = basePolicies.map((policy) => ({
    ...policy,
    policyId: `${partition}-${policy.streamTypeClass}`,
  }));

  // Add custom policies if provided
  if (customPolicies.length > 0) {
    const customPoliciesWithIds = customPolicies.map((policy) => ({
      ...policy,
      policyId:
        policy.policyId || `${partition}-${policy.streamTypeClass}-custom`,
    })) as PolicyConfig[];

    policies.push(...customPoliciesWithIds);
  }

  return policies;
}
