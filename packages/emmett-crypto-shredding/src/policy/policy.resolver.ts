import { PolicyResolutionError } from "../errors.js";
import type {
  CryptoContext,
  EncryptionPolicyResolver,
  SupportedAlgorithm,
} from "../types.js";

/**
 * Database-agnostic policy data structure
 */
export interface PolicyData {
  encryptionAlgorithm: string | null;
  keyRotationIntervalDays: number | null;
  streamTypeClass: string;
  keyScope: string | null;
}

/**
 * Database-agnostic interface for policy storage operations.
 */
export interface PolicyStorage {
  findPolicy(params: {
    partition: string;
    streamType: string | null;
  }): Promise<PolicyData | null>;
}

/**
 * Type for key scope configuration
 */
export type KeyScope = "stream" | "type" | "partition";

/**
 * Resolves the key reference based on the policy's key scope and context.
 * Validates that required context fields are present for the given scope.
 */
function resolveKeyRef(keyScope: KeyScope, ctx: CryptoContext): string {
  switch (keyScope) {
    case "stream":
      if (!ctx.streamId) {
        throw new PolicyResolutionError(
          `Key scope "stream" requires streamId in context, but it was not provided`,
          ctx,
        );
      }
      return ctx.streamId;

    case "type":
      if (!ctx.streamType) {
        throw new PolicyResolutionError(
          `Key scope "type" requires streamType in context, but it was not provided`,
          ctx,
        );
      }
      return ctx.streamType;

    case "partition":
      // Partition scope = one shared key for entire partition/tenant
      // "default" is sufficient since partition is already scoped by the partition parameter
      return "default";

    default: {
      // Exhaustiveness check - TypeScript will error if we miss a case
      const _exhaustive: never = keyScope;
      throw new PolicyResolutionError(`Unknown key scope: ${_exhaustive}`, ctx);
    }
  }
}

/**
 * Database-agnostic EncryptionPolicyResolver implementation.
 */
export function createPolicyResolver(
  storage: PolicyStorage,
  onError?: (error: unknown, ctx: CryptoContext) => void,
): EncryptionPolicyResolver {
  return {
    async resolve(ctx: CryptoContext) {
      try {
        const policy = await storage.findPolicy({
          partition: ctx.partition,
          streamType: ctx.streamType ?? null,
        });

        if (!policy) {
          throw new PolicyResolutionError(
            `No encryption policy found for stream type "${ctx.streamType}" in partition "${ctx.partition}". ` +
              `Policies must be created before encrypting events. ` +
              `Use createPolicies() or createDefaultPolicies() to set up encryption policies.`,
            ctx,
          );
        }

        const keyScope = (policy.keyScope ?? "stream") as KeyScope;
        const keyRef = resolveKeyRef(keyScope, ctx);

        return {
          encrypt: true,
          algo: (policy.encryptionAlgorithm as SupportedAlgorithm) ?? "AES-GCM",
          keyRef,
        };
      } catch (error) {
        // Re-throw validation errors (PolicyResolutionError) - these indicate misconfiguration
        if (error instanceof PolicyResolutionError) {
          throw error;
        }
        // Log unexpected errors and fall back to no encryption for safety
        onError?.(error, ctx);
        return { encrypt: false };
      }
    },
  };
}
