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
          return { encrypt: false };
        }

        // Policy exists means encryption is required
        // Derive keyRef from keyScope (business logic for determining key reference)
        const keyScope = (policy.keyScope ?? "type") as KeyScope;

        // Determine keyRef based on scope, validating required context:
        // - "stream": Requires streamId (unique key per stream)
        // - "type": Requires streamType (one key per stream type)
        // - "partition": Always uses "default" (shared key for entire partition)
        let keyRef: string;
        if (keyScope === "stream") {
          if (!ctx.streamId) {
            throw new PolicyResolutionError(
              `Key scope "stream" requires streamId in context, but it was not provided`,
              ctx,
            );
          }
          keyRef = ctx.streamId;
        } else if (keyScope === "type") {
          if (!ctx.streamType) {
            throw new PolicyResolutionError(
              `Key scope "type" requires streamType in context, but it was not provided`,
              ctx,
            );
          }
          keyRef = ctx.streamType;
        } else {
          // keyScope === "partition"
          keyRef = "default";
        }

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
