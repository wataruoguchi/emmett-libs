import {
  PolicyResolutionError,
  createPolicyResolver as createPolicyResolverCore,
  getDefaultPolicies,
  type CryptoContext,
  type EncryptionPolicyResolver,
  type KeyScope,
  type PolicyConfig,
  type PolicyStorage,
  type SupportedAlgorithm,
} from "@wataruoguchi/emmett-crypto-shredding";
import type { Kysely } from "kysely";

/**
 * Simple logger interface that matches common logger implementations.
 * Compatible with Pino, Winston, and other structured loggers.
 */
export interface Logger {
  warn?: (obj: unknown, msg?: string) => void;
  error?: (obj: unknown, msg?: string) => void;
  info?: (obj: unknown, msg?: string) => void;
  debug?: (obj: unknown, msg?: string) => void;
}

/**
 * Kysely-specific implementation of PolicyStorage interface.
 * This adapter translates the abstract PolicyStorage operations into Kysely queries.
 *
 * Note: The database type DB must include the encryption_keys and encryption_policies tables
 * defined in CryptoDatabase, but we use a flexible type constraint to work with any
 * Kysely instance that has these tables.
 *
 * The `Kysely<any> | any` type is intentional to work around Kysely's private field variance
 * issue in TypeScript, allowing DatabaseExecutor and other Kysely-compatible types to be passed.
 * The `as any` casts for table names are necessary because Kysely cannot infer types for
 * dynamically accessed table names at compile time.
 */
function createKyselyPolicyStorage(
  db: Kysely<any> | any,
  logger?: Logger,
): PolicyStorage {
  return {
    async findPolicy({ partition, streamType }) {
      // Require streamType to be explicitly provided - no implicit "default" lookup
      if (streamType === null || streamType === undefined) {
        throw new PolicyResolutionError(
          `streamType is required for policy lookup but was not provided (partition: ${partition})`,
          {
            partition,
            streamId: "", // Not available at this point
            streamType: undefined, // Explicitly undefined since it's missing
          },
        );
      }

      const policy = await (db.selectFrom("encryption_policies" as any) as any)
        .select([
          "encryption_algorithm",
          "key_rotation_interval_days",
          "stream_type_class",
          "key_scope",
        ])
        .where("partition", "=", partition)
        .where("stream_type_class", "=", streamType)
        .executeTakeFirst();

      if (!policy) {
        logger?.warn?.(
          {
            partition,
            streamType,
          },
          "No encryption policy found for context. Skipping encryption.",
        );
        return null;
      }

      return {
        encryptionAlgorithm: policy.encryption_algorithm,
        keyRotationIntervalDays: policy.key_rotation_interval_days,
        streamTypeClass: policy.stream_type_class,
        keyScope: policy.key_scope,
      };
    },
  };
}

/**
 * Create a database-backed EncryptionPolicyResolver using Kysely.
 * This is a convenience function that combines the database-agnostic logic
 * with the Kysely-specific adapter.
 *
 * @param db - Kysely database instance that includes the CryptoDatabase schema
 * @param logger - Optional logger for policy resolution errors
 * @returns EncryptionPolicyResolver instance
 *
 * @example
 * ```typescript
 * import { createPolicyResolver } from '@wataruoguchi/emmett-crypto-shredding-kysely';
 * import type { MyDatabase } from './db-types';
 *
 * const policyResolver = createPolicyResolver(db, logger);
 * const policy = await policyResolver.resolve({
 *   partition: 'tenant-123',
 *   streamType: 'user-data'
 * });
 * ```
 */
export function createPolicyResolver(
  db: Kysely<any> | any,
  logger?: Logger,
): EncryptionPolicyResolver {
  const storage = createKyselyPolicyStorage(db, logger);
  return createPolicyResolverCore(
    storage,
    (error: unknown, ctx: CryptoContext) => {
      if (logger?.error) {
        logger.error(
          { error, context: ctx },
          "Error resolving encryption policy",
        );
      }
    },
  );
}

/**
 * Create a PolicyStorage adapter for a Kysely database.
 * This is a lower-level function if you need direct access to the storage adapter.
 *
 * @param db - Kysely database instance that includes the CryptoDatabase schema
 * @param logger - Optional logger for warnings
 * @returns PolicyStorage instance
 */
export function createPolicyStorage(
  db: Kysely<any> | any,
  logger?: Logger,
): PolicyStorage {
  return createKyselyPolicyStorage(db, logger);
}

/**
 * Database policy configuration that includes partition (required for database operations)
 */
export type DatabasePolicyConfig = PolicyConfig & { partition: string };

/**
 * Create multiple encryption policies in a single batch operation
 *
 * @param db - Kysely database instance
 * @param policies - Array of policy configurations
 *
 * @example
 * ```typescript
 * await createPolicies(db, [
 *   {
 *     policyId: 'tenant-123-user-data',
 *     partition: 'tenant-123',
 *     streamTypeClass: 'user-data',
 *     encryptionAlgorithm: 'AES-GCM',
 *     keyRotationIntervalDays: 180,
 *     keyScope: 'stream'
 *   }
 * ]);
 * ```
 */
export async function createPolicies(
  db: Kysely<any> | any,
  policies: DatabasePolicyConfig[],
): Promise<void> {
  if (policies.length === 0) return;

  await (db.insertInto("encryption_policies" as any) as any)
    .values(
      policies.map((policy) => ({
        policy_id: policy.policyId,
        partition: policy.partition,
        stream_type_class: policy.streamTypeClass,
        encryption_algorithm: policy.encryptionAlgorithm ?? "AES-GCM",
        key_rotation_interval_days: policy.keyRotationIntervalDays,
        key_scope: policy.keyScope,
      })),
    )
    .execute();
}

/**
 * Update an existing encryption policy
 *
 * @param db - Kysely database instance
 * @param policyId - Policy identifier
 * @param partition - Partition identifier
 * @param updates - Fields to update
 *
 * @example
 * ```typescript
 * await updatePolicy(db, 'tenant-123-user-data', 'tenant-123', {
 *   encryptionAlgorithm: 'AES-GCM',
 *   keyRotationIntervalDays: 365
 * });
 * ```
 */
export async function updatePolicy(
  db: Kysely<any> | any,
  policyId: string,
  partition: string,
  updates: {
    encryptionAlgorithm?: SupportedAlgorithm;
    keyRotationIntervalDays?: number;
    keyScope?: KeyScope;
  },
): Promise<void> {
  await (db.updateTable("encryption_policies" as any) as any)
    .set({
      encryption_algorithm: updates.encryptionAlgorithm ?? undefined,
      key_rotation_interval_days: updates.keyRotationIntervalDays ?? undefined,
      key_scope: updates.keyScope ?? undefined,
      updated_at: new Date(),
    })
    .where("policy_id", "=", policyId)
    .where("partition", "=", partition)
    .execute();
}

/**
 * Delete an encryption policy
 *
 * @param db - Kysely database instance
 * @param policyId - Policy identifier
 * @param partition - Partition identifier
 */
export async function deletePolicy(
  db: Kysely<any> | any,
  policyId: string,
  partition: string,
): Promise<void> {
  await (db.deleteFrom("encryption_policies" as any) as any)
    .where("policy_id", "=", policyId)
    .where("partition", "=", partition)
    .execute();
}

/**
 * List all policies for a partition
 *
 * @param db - Kysely database instance
 * @param partition - Partition identifier
 * @returns Array of policy records
 */
export async function listPolicies(db: Kysely<any> | any, partition: string) {
  return await (db.selectFrom("encryption_policies" as any) as any)
    .selectAll()
    .where("partition", "=", partition)
    .execute();
}

/**
 * Create default policies for a partition using the default policy configuration
 * from @wataruoguchi/emmett-crypto-shredding
 *
 * @param db - Kysely database instance
 * @param partition - Partition identifier
 *
 * @example
 * ```typescript
 * await createDefaultPolicies(db, 'tenant-123');
 * ```
 */
export async function createDefaultPolicies(
  db: Kysely<any> | any,
  partition: string,
): Promise<void> {
  // Use batch insert for better performance
  const defaultPolicies = getDefaultPolicies(partition).map(
    (p: PolicyConfig) => ({
      ...p,
      partition,
    }),
  );
  await createPolicies(db, defaultPolicies);
}
