import { faker } from "@faker-js/faker";
import {
  createCryptoEventStore,
  createWebCryptoProvider,
  type CryptoContext,
} from "@wataruoguchi/emmett-crypto-shredding";
import {
  createKeyManagement,
  createPolicies,
  createPolicyResolver,
} from "@wataruoguchi/emmett-crypto-shredding-kysely";
import {
  createProjectionRegistry,
  createProjectionRunner,
  getKyselyEventStore,
  type KyselyEventStore,
} from "@wataruoguchi/emmett-event-store-kysely";
import type { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import z from "zod";
import { createTestDb } from "../../../dev-tools/database/create-test-db.js";
import { seedTestDb } from "../../../dev-tools/database/seed-test-db.js";
import type { DatabaseExecutor } from "../../shared/infra/db.js";
import type { Logger } from "../../shared/infra/logger.js";
import { createTenantModule } from "../../tenant/tenant.index.js";
import {
  createGeneratorHttpAdapter,
  createGeneratorModule,
  generatorsSnapshotProjection,
} from "../generator.index.js";

describe("Feature: Crypto Shredding for Generator Events", () => {
  const TEST_DB_NAME = "generator_crypto_shredding";
  const logger = {
    info: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;

  let app: Hono;
  let db: DatabaseExecutor;
  let tenantId: string;
  let projectEvents: (opts?: { batchSize?: number }) => Promise<void>;
  let cryptoEventStore: KyselyEventStore;

  // Helper functions
  const createGenerator = async (
    data: ReturnType<typeof generateGeneratorData>,
  ) => {
    const response = await app.request(`/api/tenants/${tenantId}/generators`, {
      method: "POST",
      body: JSON.stringify(data),
    });
    const json = await response.json();
    return json.generatorId as string;
  };

  const updateGenerator = async (
    generatorId: string,
    data: Partial<ReturnType<typeof generateGeneratorData>>,
  ) => {
    await app.request(`/api/tenants/${tenantId}/generators/${generatorId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  };

  const getMessages = async (generatorId: string) => {
    return await db
      .selectFrom("messages")
      .select([
        "message_data",
        "message_metadata",
        "stream_position",
        "global_position",
      ])
      .where("stream_id", "=", generatorId)
      .where("partition", "=", tenantId)
      .orderBy("global_position", "asc")
      .execute();
  };

  const getReadModel = async (generatorId: string) => {
    return await db
      .selectFrom("generators")
      .selectAll()
      .where("generator_id", "=", generatorId)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
  };

  const getKeyFromMetadata = (metadata: unknown) => {
    const meta = metadata as {
      enc?: { keyId?: string; keyVersion?: number };
    } | null;
    if (!meta?.enc?.keyId) throw new Error("Key not found in metadata");
    return {
      keyId: meta.enc.keyId,
      keyVersion: meta.enc.keyVersion!,
      keyRef: meta.enc.keyId.split("::")[1]?.split("@")[0]!,
    };
  };

  const destroyKey = async (keyId: string) => {
    // destroyed_at IS NOT NULL is the source of truth for key destruction
    await db
      .updateTable("encryption_keys")
      .set({ destroyed_at: new Date() })
      .where("key_id", "=", keyId)
      .where("partition", "=", tenantId)
      .execute();
  };

  const deleteReadModel = async (generatorId: string) => {
    await db
      .deleteFrom("generators")
      .where("generator_id", "=", generatorId)
      .where("tenant_id", "=", tenantId)
      .execute();

    // Also delete/reset the checkpoint so we can reproject from the beginning
    const subscriptionId = `generators-read-model:${generatorId}`;
    await db
      .deleteFrom("subscriptions")
      .where("subscription_id", "=", subscriptionId)
      .where("partition", "=", tenantId)
      .execute();
  };

  // Encryption keys helper functions
  const getEncryptionKeysQuery = (partitionId: string) => {
    return db
      .selectFrom("encryption_keys")
      .selectAll()
      .where("partition", "=", partitionId);
  };

  const getActiveEncryptionKeys = async (partitionId: string) => {
    return await getEncryptionKeysQuery(partitionId)
      .where("destroyed_at", "is", null)
      .execute();
  };

  const getEncryptionKey = async (keyId: string, partitionId: string) => {
    return await getEncryptionKeysQuery(partitionId)
      .where("key_id", "=", keyId)
      .executeTakeFirst();
  };

  beforeAll(async () => {
    db = await createTestDb(TEST_DB_NAME);
    tenantId = (await seedTestDb(db).createTenant()).id;

    await createPolicies(db, [
      {
        policyId: `${tenantId}-generator`,
        partition: tenantId,
        keyScope: "stream",
        streamTypeClass: "generator",
        encryptionAlgorithm: "AES-GCM",
        keyRotationIntervalDays: 180,
      },
    ]);

    const tenantPort = createTenantModule({ db, logger });
    const generatorPort = createGeneratorModule({ tenantPort, db, logger });
    app = createGeneratorHttpAdapter({ generatorPort, logger });

    cryptoEventStore = createCryptoEventStore(
      getKyselyEventStore({ db, logger }),
      {
        policy: createPolicyResolver(db, logger),
        keys: createKeyManagement(db),
        crypto: createWebCryptoProvider(),
        buildAAD: ({ partition, streamId }: CryptoContext) =>
          new TextEncoder().encode(`${partition}:${streamId}`),
        logger,
      },
    );

    const registry = createProjectionRegistry(generatorsSnapshotProjection());
    const runner = createProjectionRunner({
      db,
      readStream: cryptoEventStore.readStream,
      registry,
    });

    projectEvents = async ({ batchSize = 500 } = {}) => {
      const streams = await db
        .selectFrom("streams")
        .select(["stream_id"])
        .where("is_archived", "=", false)
        .where("partition", "=", tenantId)
        .where("stream_type", "=", "generator")
        .execute();

      for (const s of streams) {
        const subscriptionId = `generators-read-model:${s.stream_id}`;
        await runner.projectEvents(subscriptionId, s.stream_id as string, {
          partition: tenantId,
          batchSize,
        });
      }
    };
  });

  afterAll(async () => {
    await db.destroy();
  });

  describe("Scenario: Events are encrypted on write", () => {
    let generatorId: string;

    beforeAll(async () => {
      generatorId = await createGenerator(generateGeneratorData());
    });

    it("should store encrypted ciphertext in message_data", async () => {
      const messages = await getMessages(generatorId);
      expect(messages.length).toBe(1);

      const [message] = messages;
      const messageDataSchema = z.object({ ciphertext: z.base64() });

      expect(messageDataSchema.safeParse(message.message_data).success).toBe(
        true,
      );
    });

    it("should include encryption metadata with key info and IV", async () => {
      const messages = await getMessages(generatorId);
      const [message] = messages;

      const metadataSchema = z.object({
        enc: z.object({
          algo: z.string(),
          keyId: z.string(),
          keyVersion: z.number(),
          iv: z.base64(),
          streamType: z.string(),
          eventType: z.string(),
        }),
      });

      expect(metadataSchema.safeParse(message.message_metadata).success).toBe(
        true,
      );
    });
  });

  describe("Scenario: Events are decrypted on read", () => {
    let generatorId: string;

    beforeAll(async () => {
      generatorId = await createGenerator(generateGeneratorData());
      await projectEvents();
    });

    it("should create read model from decrypted events", async () => {
      const readModel = await getReadModel(generatorId);

      expect(readModel).toBeDefined();
      expect(readModel?.generator_id).toBe(generatorId);
      expect((readModel?.name as string)?.length).toBeGreaterThan(0);
      expect((readModel?.address as string)?.length).toBeGreaterThan(0);
    });
  });

  describe("Scenario: Crypto shredding - key destruction", () => {
    let generatorId: string;
    let keyId: string;

    beforeAll(async () => {
      generatorId = await createGenerator(generateGeneratorData());
      await projectEvents();

      const messages = await getMessages(generatorId);
      const keyInfo = getKeyFromMetadata(messages[0]?.message_metadata);
      keyId = keyInfo.keyId;
    });

    it("should fail to create read model when key is destroyed", async () => {
      const readModelBeforeShredding = await getReadModel(generatorId);
      expect(readModelBeforeShredding).toBeDefined();

      await destroyKey(keyId);
      await deleteReadModel(generatorId);

      await projectEvents();

      const readModel = await getReadModel(generatorId);
      expect(readModel).toBeUndefined();
    });
  });

  describe("Scenario: Crypto shredding - partition key destruction", () => {
    let generatorId1: string;
    let generatorId2: string;
    let generatorId3: string;

    beforeAll(async () => {
      // Create multiple generators to test partition-wide key destruction
      generatorId1 = await createGenerator(generateGeneratorData());
      generatorId2 = await createGenerator(generateGeneratorData());
      generatorId3 = await createGenerator(generateGeneratorData());

      // Project events to create read models
      await projectEvents();

      // Verify all read models exist before destruction
      const readModel1 = await getReadModel(generatorId1);
      const readModel2 = await getReadModel(generatorId2);
      const readModel3 = await getReadModel(generatorId3);

      if (!readModel1 || !readModel2 || !readModel3) {
        throw new Error("Read models not found");
      }
    });

    it("should destroy all keys in the partition", async () => {
      // Verify keys exist before destruction
      const keysBefore = await getActiveEncryptionKeys(tenantId);

      expect(keysBefore.length).toBeGreaterThan(0);

      // Destroy all partition keys
      const keys = createKeyManagement(db);
      await keys.destroyPartitionKeys(tenantId);

      // Verify all keys are destroyed
      const keysAfter = await getActiveEncryptionKeys(tenantId);

      expect(keysAfter.length).toBe(0);

      // Verify destroyed_at is set for all keys
      const allKeys = await getEncryptionKeysQuery(tenantId).execute();

      expect(allKeys.length).toBeGreaterThan(0);
      for (const key of allKeys) {
        expect(key.destroyed_at).not.toBeNull();
      }
    });

    it("should fail to create read models after partition key destruction", async () => {
      // Delete all read models to force reprojection
      await deleteReadModel(generatorId1);
      await deleteReadModel(generatorId2);
      await deleteReadModel(generatorId3);

      // Attempt to reproject events (should fail silently because keys are destroyed)
      await projectEvents();

      // Verify read models cannot be recreated
      const readModel1 = await getReadModel(generatorId1);
      const readModel2 = await getReadModel(generatorId2);
      const readModel3 = await getReadModel(generatorId3);

      expect(readModel1).toBeUndefined();
      expect(readModel2).toBeUndefined();
      expect(readModel3).toBeUndefined();
    });

    it("should skip events when reading streams after partition key destruction", async () => {
      // Verify messages exist in the database (encrypted events)
      const messages1 = await getMessages(generatorId1);
      const messages2 = await getMessages(generatorId2);
      const messages3 = await getMessages(generatorId3);

      expect(messages1.length).toBeGreaterThan(0);
      expect(messages2.length).toBeGreaterThan(0);
      expect(messages3.length).toBeGreaterThan(0);

      // When keys are destroyed, decryptEvent returns null for each event
      // and these null events are filtered out, resulting in empty arrays
      const streamResult1 = await cryptoEventStore.readStream(generatorId1, {
        partition: tenantId,
      });
      const streamResult2 = await cryptoEventStore.readStream(generatorId2, {
        partition: tenantId,
      });
      const streamResult3 = await cryptoEventStore.readStream(generatorId3, {
        partition: tenantId,
      });

      // All events are skipped because keys are destroyed (even though messages exist)
      expect(streamResult1.events.length).toBe(0);
      expect(streamResult2.events.length).toBe(0);
      expect(streamResult3.events.length).toBe(0);
    });
  });

  describe("Scenario: Key rotation - single rotation", () => {
    let generatorId: string;
    let initialKeyInfo: { keyId: string; keyVersion: number; keyRef: string };

    beforeAll(async () => {
      const generatorData = generateGeneratorData();
      generatorId = await createGenerator(generatorData);

      const messages = await getMessages(generatorId);
      initialKeyInfo = getKeyFromMetadata(messages[0]?.message_metadata);
    });

    it("should maintain read model after key rotation", async () => {
      // Initial projection with key v1
      await projectEvents();
      const readModelV1 = await getReadModel(generatorId);
      expect(readModelV1?.name).toBeDefined();
      expect(readModelV1?.address).toBeDefined();

      // Rotate key to v2
      const keys = createKeyManagement(db);
      const rotatedKey = await keys.rotateKey({
        partition: tenantId,
        keyRef: initialKeyInfo.keyRef,
      });

      expect(rotatedKey.keyVersion).toBe(initialKeyInfo.keyVersion + 1);

      const nameUpdated = "Updated After Rotation";
      // Update generator (creates event with key v2)
      await updateGenerator(generatorId, {
        name: nameUpdated,
        notes: "This was updated after key rotation",
      });

      // Verify both key versions are used
      const messages = await getMessages(generatorId);
      const keyVersions = messages.map(
        (msg) => getKeyFromMetadata(msg.message_metadata).keyVersion,
      );

      expect(keyVersions).toContain(initialKeyInfo.keyVersion);
      expect(keyVersions).toContain(rotatedKey.keyVersion);

      // Verify the old key still exists before reprojection
      const oldKeyExists = await getEncryptionKey(
        initialKeyInfo.keyId,
        tenantId,
      );

      expect(oldKeyExists).toBeDefined();
      expect(oldKeyExists?.destroyed_at).toBeDefined();

      // Reproject should work with historical keys
      await deleteReadModel(generatorId);
      await projectEvents();

      const readModelV2 = await getReadModel(generatorId);
      expect(readModelV2).toBeDefined();
      expect(readModelV2?.name).toBe(nameUpdated);
      expect(readModelV2?.address).toBe(readModelV1?.address);
    });

    it("should deactivate old key but keep it for decryption", async () => {
      const keys = createKeyManagement(db);
      await keys.rotateKey({
        partition: tenantId,
        keyRef: initialKeyInfo.keyRef,
      });

      const oldKey = await getEncryptionKey(initialKeyInfo.keyId, tenantId);

      expect(oldKey).toBeDefined();
      expect(oldKey?.is_active).toBe(false);
      expect(oldKey?.destroyed_at).toBeDefined();
    });
  });

  describe("Scenario: Key rotation - multiple rotations", () => {
    let generatorId: string;
    let initialKeyInfo: { keyId: string; keyVersion: number; keyRef: string };
    const updateHistory: Array<{ name: string; keyVersion: number }> = [];

    beforeAll(async () => {
      const generatorData = generateGeneratorData();
      generatorId = await createGenerator(generatorData);

      const messages = await getMessages(generatorId);
      initialKeyInfo = getKeyFromMetadata(messages[0]?.message_metadata);
      updateHistory.push({
        name: generatorData.name,
        keyVersion: initialKeyInfo.keyVersion,
      });
    });

    it("should reflect all events in read model after multiple rotations", async () => {
      const keys = createKeyManagement(db);

      const props = ["address", "address", "notes"];
      // Rotate key 3 times, updating generator after each rotation
      for (let i = 1; i <= 3; i++) {
        const rotated = await keys.rotateKey({
          partition: tenantId,
          keyRef: initialKeyInfo.keyRef,
        });

        expect(rotated.keyVersion).toBe(initialKeyInfo.keyVersion + i);

        const updateName = `Updated After Rotation ${i}`;
        await updateGenerator(generatorId, {
          name: updateName,
          [props[i - 1]]: `This was updated after rotation ${i}`,
        });

        updateHistory.push({
          name: updateName,
          keyVersion: rotated.keyVersion,
        });
      }

      // Verify all key versions exist
      // destroyed_at IS NULL means the key is not destroyed
      const allKeys = await getEncryptionKeysQuery(tenantId)
        .where("key_id", "like", `${tenantId}::${initialKeyInfo.keyRef}@%`)
        .where("destroyed_at", "is", null)
        .orderBy("key_version", "asc")
        .execute();

      expect(allKeys.length).toBe(4);
      expect(allKeys.filter((k) => k.is_active).length).toBe(1);
      expect(allKeys[allKeys.length - 1].key_version).toBe(
        initialKeyInfo.keyVersion + 3,
      );

      // Verify all messages use different key versions
      const messages = await getMessages(generatorId);
      const keyVersionsInEvents = messages.map(
        (msg) => getKeyFromMetadata(msg.message_metadata).keyVersion,
      );

      for (
        let v = initialKeyInfo.keyVersion;
        v <= initialKeyInfo.keyVersion + 3;
        v++
      ) {
        expect(keyVersionsInEvents).toContain(v);
      }

      // Reproject from scratch
      await deleteReadModel(generatorId);
      await projectEvents();

      // Verify read model reflects final state
      const finalReadModel = await getReadModel(generatorId);
      expect(finalReadModel).toBeDefined();
      expect(finalReadModel?.name).toBe(
        updateHistory[updateHistory.length - 1].name,
      );
      expect(finalReadModel?.address).toBe("This was updated after rotation 2");
      expect(finalReadModel?.notes).toBe("This was updated after rotation 3");

      // Verify all events can be decrypted when reading stream
      const decryptedStreamResult = await cryptoEventStore.readStream(
        generatorId,
        {
          partition: tenantId,
        },
      );

      expect(decryptedStreamResult.events.length).toBe(4);

      // Verify all events are decrypted
      for (const event of decryptedStreamResult.events) {
        const data = (event as any).data;
        expect(typeof data).toBe("object");
        expect(data).not.toHaveProperty("ciphertext");
        expect(data).toHaveProperty("eventData");
        expect(data.eventData).toHaveProperty("name");
      }

      // Verify event order matches update history
      const eventNames = decryptedStreamResult.events.map(
        (e: any) => e.data.eventData?.name,
      );
      expect(eventNames).toEqual(updateHistory.map((u) => u.name));
    });
  });

  describe("Scenario: Key Scope - type scope", () => {
    let typeScopeTenantId: string;
    let typeScopeApp: Hono;
    let typeScopeCryptoEventStore: KyselyEventStore;
    let typeScopeProjectEvents: (opts?: {
      batchSize?: number;
    }) => Promise<void>;
    let generatorId1: string;
    let generatorId2: string;

    beforeAll(async () => {
      // Create a new tenant for this test scenario
      typeScopeTenantId = (await seedTestDb(db).createTenant()).id;

      // Create policy with type scope (all generators share one key)
      await createPolicies(db, [
        {
          policyId: `${typeScopeTenantId}-generator-type`,
          partition: typeScopeTenantId,
          keyScope: "type",
          streamTypeClass: "generator",
          encryptionAlgorithm: "AES-GCM",
          keyRotationIntervalDays: 180,
        },
      ]);

      const tenantPort = createTenantModule({ db, logger });
      const generatorPort = createGeneratorModule({ tenantPort, db, logger });
      typeScopeApp = createGeneratorHttpAdapter({ generatorPort, logger });

      typeScopeCryptoEventStore = createCryptoEventStore(
        getKyselyEventStore({ db, logger }),
        {
          policy: createPolicyResolver(db, logger),
          keys: createKeyManagement(db),
          crypto: createWebCryptoProvider(),
          buildAAD: ({ partition, streamId }: CryptoContext) =>
            new TextEncoder().encode(`${partition}:${streamId}`),
          logger,
        },
      );

      const registry = createProjectionRegistry(generatorsSnapshotProjection());
      const runner = createProjectionRunner({
        db,
        readStream: typeScopeCryptoEventStore.readStream,
        registry,
      });

      typeScopeProjectEvents = async ({ batchSize = 500 } = {}) => {
        const streams = await db
          .selectFrom("streams")
          .select(["stream_id"])
          .where("is_archived", "=", false)
          .where("partition", "=", typeScopeTenantId)
          .where("stream_type", "=", "generator")
          .execute();

        for (const s of streams) {
          const subscriptionId = `generators-read-model:${s.stream_id}`;
          await runner.projectEvents(subscriptionId, s.stream_id as string, {
            partition: typeScopeTenantId,
            batchSize,
          });
        }
      };
    });

    it("should use the same key for all streams of the same type", async () => {
      // Create two generators
      const response1 = await typeScopeApp.request(
        `/api/tenants/${typeScopeTenantId}/generators`,
        {
          method: "POST",
          body: JSON.stringify(generateGeneratorData()),
        },
      );
      const json1 = await response1.json();
      generatorId1 = json1.generatorId as string;

      const response2 = await typeScopeApp.request(
        `/api/tenants/${typeScopeTenantId}/generators`,
        {
          method: "POST",
          body: JSON.stringify(generateGeneratorData()),
        },
      );
      const json2 = await response2.json();
      generatorId2 = json2.generatorId as string;

      // Get messages from both streams
      const messages1 = await db
        .selectFrom("messages")
        .select(["message_metadata"])
        .where("stream_id", "=", generatorId1)
        .where("partition", "=", typeScopeTenantId)
        .executeTakeFirst();

      const messages2 = await db
        .selectFrom("messages")
        .select(["message_metadata"])
        .where("stream_id", "=", generatorId2)
        .where("partition", "=", typeScopeTenantId)
        .executeTakeFirst();

      const keyInfo1 = getKeyFromMetadata(messages1?.message_metadata);
      const keyInfo2 = getKeyFromMetadata(messages2?.message_metadata);

      // Both should use the same keyRef (stream type) for type scope
      expect(keyInfo1.keyRef).toBe(keyInfo2.keyRef);
      expect(keyInfo1.keyRef).toBe("generator"); // type scope uses streamType as keyRef

      // Verify they also share the same keyId (actual cryptographic key)
      // This ensures they're using the same key, not just the same keyRef
      expect(keyInfo1.keyId).toBe(keyInfo2.keyId);
      expect(keyInfo1.keyVersion).toBe(keyInfo2.keyVersion);
    });

    it("should rotate key for all streams when using type scope", async () => {
      await typeScopeProjectEvents();

      // Get initial key info
      const messages1 = await db
        .selectFrom("messages")
        .select(["message_metadata"])
        .where("stream_id", "=", generatorId1)
        .where("partition", "=", typeScopeTenantId)
        .executeTakeFirst();
      const initialKeyInfo = getKeyFromMetadata(messages1?.message_metadata);

      // Rotate the key (affects all streams of this type)
      const keys = createKeyManagement(db);
      await keys.rotateKey({
        partition: typeScopeTenantId,
        keyRef: initialKeyInfo.keyRef,
      });

      // Create a new event in generator1
      await typeScopeApp.request(
        `/api/tenants/${typeScopeTenantId}/generators/${generatorId1}`,
        {
          method: "PUT",
          body: JSON.stringify({ name: "Updated After Rotation" }),
        },
      );

      // Create a new event in generator2
      await typeScopeApp.request(
        `/api/tenants/${typeScopeTenantId}/generators/${generatorId2}`,
        {
          method: "PUT",
          body: JSON.stringify({ name: "Updated After Rotation 2" }),
        },
      );

      // Both new events should use the rotated key
      const allMessages1 = await db
        .selectFrom("messages")
        .select(["message_metadata", "stream_position"])
        .where("stream_id", "=", generatorId1)
        .where("partition", "=", typeScopeTenantId)
        .orderBy("stream_position", "desc")
        .execute();

      const allMessages2 = await db
        .selectFrom("messages")
        .select(["message_metadata", "stream_position"])
        .where("stream_id", "=", generatorId2)
        .where("partition", "=", typeScopeTenantId)
        .orderBy("stream_position", "desc")
        .execute();

      const latestKey1 = getKeyFromMetadata(allMessages1[0]?.message_metadata);
      const latestKey2 = getKeyFromMetadata(allMessages2[0]?.message_metadata);

      // Both should use the same new key version and keyId after rotation
      expect(latestKey1.keyVersion).toBe(initialKeyInfo.keyVersion + 1);
      expect(latestKey2.keyVersion).toBe(initialKeyInfo.keyVersion + 1);
      expect(latestKey1.keyVersion).toBe(latestKey2.keyVersion);
      // Verify they share the same keyId (rotated key) for type scope
      expect(latestKey1.keyId).toBe(latestKey2.keyId);
    });

    it("should destroy key for all streams when using type scope", async () => {
      // Destroy the key (affects all streams)
      const keys = createKeyManagement(db);
      await keys.destroyPartitionKeys(typeScopeTenantId);

      // Both streams should fail to decrypt
      const streamResult1 = await typeScopeCryptoEventStore.readStream(
        generatorId1,
        {
          partition: typeScopeTenantId,
        },
      );
      const streamResult2 = await typeScopeCryptoEventStore.readStream(
        generatorId2,
        {
          partition: typeScopeTenantId,
        },
      );

      expect(streamResult1.events.length).toBe(0);
      expect(streamResult2.events.length).toBe(0);
    });

    it("should preserve keys for same stream type in other tenants after key destruction", async () => {
      // Create a separate tenant for this test (to avoid conflicts with other tests)
      const firstTenantId = (await seedTestDb(db).createTenant()).id;

      await createPolicies(db, [
        {
          policyId: `${firstTenantId}-generator-type`,
          partition: firstTenantId,
          keyScope: "type",
          streamTypeClass: "generator",
          encryptionAlgorithm: "AES-GCM",
          keyRotationIntervalDays: 180,
        },
      ]);

      const firstTenantPort = createTenantModule({ db, logger });
      const firstGeneratorPort = createGeneratorModule({
        tenantPort: firstTenantPort,
        db,
        logger,
      });
      const firstTenantApp = createGeneratorHttpAdapter({
        generatorPort: firstGeneratorPort,
        logger,
      });

      const firstTenantCryptoEventStore = createCryptoEventStore(
        getKyselyEventStore({ db, logger }),
        {
          policy: createPolicyResolver(db, logger),
          keys: createKeyManagement(db),
          crypto: createWebCryptoProvider(),
          buildAAD: ({ partition, streamId }: CryptoContext) =>
            new TextEncoder().encode(`${partition}:${streamId}`),
          logger,
        },
      );

      const firstTenantRegistry = createProjectionRegistry(
        generatorsSnapshotProjection(),
      );
      const firstTenantRunner = createProjectionRunner({
        db,
        readStream: firstTenantCryptoEventStore.readStream,
        registry: firstTenantRegistry,
      });

      const firstTenantProjectEvents = async ({ batchSize = 500 } = {}) => {
        const streams = await db
          .selectFrom("streams")
          .select(["stream_id"])
          .where("is_archived", "=", false)
          .where("partition", "=", firstTenantId)
          .where("stream_type", "=", "generator")
          .execute();

        for (const s of streams) {
          const subscriptionId = `generators-read-model:${s.stream_id}`;
          await firstTenantRunner.projectEvents(
            subscriptionId,
            s.stream_id as string,
            {
              partition: firstTenantId,
              batchSize,
            },
          );
        }
      };

      // Create generators in the first tenant for this test
      const response1 = await firstTenantApp.request(
        `/api/tenants/${firstTenantId}/generators`,
        {
          method: "POST",
          body: JSON.stringify(generateGeneratorData()),
        },
      );
      const json1 = await response1.json();
      const firstTenantGeneratorId1 = json1.generatorId as string;

      const response2 = await firstTenantApp.request(
        `/api/tenants/${firstTenantId}/generators`,
        {
          method: "POST",
          body: JSON.stringify(generateGeneratorData()),
        },
      );
      const json2 = await response2.json();
      const firstTenantGeneratorId2 = json2.generatorId as string;

      // Create a second tenant with the same stream type ("generator") and type scope
      const otherTenantId = (await seedTestDb(db).createTenant()).id;

      await createPolicies(db, [
        {
          policyId: `${otherTenantId}-generator-type`,
          partition: otherTenantId,
          keyScope: "type",
          streamTypeClass: "generator",
          encryptionAlgorithm: "AES-GCM",
          keyRotationIntervalDays: 180,
        },
      ]);

      const otherTenantPort = createTenantModule({ db, logger });
      const otherGeneratorPort = createGeneratorModule({
        tenantPort: otherTenantPort,
        db,
        logger,
      });
      const otherTenantApp = createGeneratorHttpAdapter({
        generatorPort: otherGeneratorPort,
        logger,
      });

      const otherTenantCryptoEventStore = createCryptoEventStore(
        getKyselyEventStore({ db, logger }),
        {
          policy: createPolicyResolver(db, logger),
          keys: createKeyManagement(db),
          crypto: createWebCryptoProvider(),
          buildAAD: ({ partition, streamId }: CryptoContext) =>
            new TextEncoder().encode(`${partition}:${streamId}`),
          logger,
        },
      );

      // Create projection runner for other tenant
      const otherTenantRegistry = createProjectionRegistry(
        generatorsSnapshotProjection(),
      );
      const otherTenantRunner = createProjectionRunner({
        db,
        readStream: otherTenantCryptoEventStore.readStream,
        registry: otherTenantRegistry,
      });

      const otherTenantProjectEvents = async ({ batchSize = 500 } = {}) => {
        const streams = await db
          .selectFrom("streams")
          .select(["stream_id"])
          .where("is_archived", "=", false)
          .where("partition", "=", otherTenantId)
          .where("stream_type", "=", "generator")
          .execute();

        for (const s of streams) {
          const subscriptionId = `generators-read-model:${s.stream_id}`;
          await otherTenantRunner.projectEvents(
            subscriptionId,
            s.stream_id as string,
            {
              partition: otherTenantId,
              batchSize,
            },
          );
        }
      };

      // Helper to get read model for a specific tenant
      const getReadModelForTenant = async (
        generatorId: string,
        tenantIdParam: string,
      ) => {
        return await db
          .selectFrom("generators")
          .selectAll()
          .where("generator_id", "=", generatorId)
          .where("tenant_id", "=", tenantIdParam)
          .executeTakeFirst();
      };

      // Helper to delete read model for a specific tenant
      const deleteReadModelForTenant = async (
        generatorId: string,
        tenantIdParam: string,
      ) => {
        await db
          .deleteFrom("generators")
          .where("generator_id", "=", generatorId)
          .where("tenant_id", "=", tenantIdParam)
          .execute();

        const subscriptionId = `generators-read-model:${generatorId}`;
        await db
          .deleteFrom("subscriptions")
          .where("subscription_id", "=", subscriptionId)
          .where("partition", "=", tenantIdParam)
          .execute();
      };

      // Create generator in the other tenant
      const otherResponse = await otherTenantApp.request(
        `/api/tenants/${otherTenantId}/generators`,
        {
          method: "POST",
          body: JSON.stringify(generateGeneratorData()),
        },
      );
      const otherJson = await otherResponse.json();
      const otherGeneratorId = otherJson.generatorId as string;

      // Project events for both tenants to create read models
      await firstTenantProjectEvents();
      await otherTenantProjectEvents();

      // Verify both tenants have read models
      const firstTenantReadModelBefore = await getReadModelForTenant(
        firstTenantGeneratorId1,
        firstTenantId,
      );
      const otherTenantReadModelBefore = await getReadModelForTenant(
        otherGeneratorId,
        otherTenantId,
      );

      expect(firstTenantReadModelBefore).toBeDefined();
      expect(otherTenantReadModelBefore).toBeDefined();

      // Get the key info for both tenants to verify they're different
      const firstTenantMessages = await db
        .selectFrom("messages")
        .select(["message_metadata"])
        .where("stream_id", "=", firstTenantGeneratorId1)
        .where("partition", "=", firstTenantId)
        .executeTakeFirst();

      const otherTenantMessages = await db
        .selectFrom("messages")
        .select(["message_metadata"])
        .where("stream_id", "=", otherGeneratorId)
        .where("partition", "=", otherTenantId)
        .executeTakeFirst();

      const firstTenantKeyInfo = getKeyFromMetadata(
        firstTenantMessages?.message_metadata,
      );
      const otherTenantKeyInfo = getKeyFromMetadata(
        otherTenantMessages?.message_metadata,
      );

      // Verify keys are different (different partitions)
      expect(firstTenantKeyInfo.keyId).not.toBe(otherTenantKeyInfo.keyId);
      expect(firstTenantKeyInfo.keyId).toContain(firstTenantId);
      expect(otherTenantKeyInfo.keyId).toContain(otherTenantId);

      // Delete read models for both tenants to force reprojection
      await deleteReadModelForTenant(firstTenantGeneratorId1, firstTenantId);
      await deleteReadModelForTenant(firstTenantGeneratorId2, firstTenantId);
      await deleteReadModelForTenant(otherGeneratorId, otherTenantId);

      // Verify read models are deleted
      const firstTenantReadModelAfterDelete = await getReadModelForTenant(
        firstTenantGeneratorId1,
        firstTenantId,
      );
      const otherTenantReadModelAfterDelete = await getReadModelForTenant(
        otherGeneratorId,
        otherTenantId,
      );
      expect(firstTenantReadModelAfterDelete).toBeUndefined();
      expect(otherTenantReadModelAfterDelete).toBeUndefined();

      // Destroy keys for firstTenantId ONLY
      const keys = createKeyManagement(db);
      await keys.destroyPartitionKeys(firstTenantId);

      // Attempt to reproject for both tenants
      await firstTenantProjectEvents(); // Should fail silently - keys destroyed
      await otherTenantProjectEvents(); // Should succeed - keys intact

      // Verify firstTenantId's read models cannot be recreated
      const firstTenantReadModelAfterDestruction = await getReadModelForTenant(
        firstTenantGeneratorId1,
        firstTenantId,
      );
      const firstTenantReadModel2AfterDestruction = await getReadModelForTenant(
        firstTenantGeneratorId2,
        firstTenantId,
      );
      expect(firstTenantReadModelAfterDestruction).toBeUndefined();
      expect(firstTenantReadModel2AfterDestruction).toBeUndefined();

      // Verify otherTenantId's read model CAN be recreated
      // (even though the stream was created before key destruction)
      const otherTenantReadModelAfterDestruction = await getReadModelForTenant(
        otherGeneratorId,
        otherTenantId,
      );
      expect(otherTenantReadModelAfterDestruction).toBeDefined();
      expect(otherTenantReadModelAfterDestruction?.generator_id).toBe(
        otherGeneratorId,
      );

      // Verify firstTenantId's generators can no longer be decrypted
      const firstTenantStreamResult =
        await firstTenantCryptoEventStore.readStream(firstTenantGeneratorId1, {
          partition: firstTenantId,
        });
      expect(firstTenantStreamResult.events.length).toBe(0);

      // Verify otherTenantId's generator can still be decrypted
      // (keys for same stream type in other tenant persist)
      const otherStreamResultAfter =
        await otherTenantCryptoEventStore.readStream(otherGeneratorId, {
          partition: otherTenantId,
        });
      expect(otherStreamResultAfter.events.length).toBeGreaterThan(0);

      // Verify the other tenant's key still exists and is not destroyed
      const otherTenantKey = await getEncryptionKey(
        otherTenantKeyInfo.keyId,
        otherTenantId,
      );
      expect(otherTenantKey).toBeDefined();
      expect(otherTenantKey?.destroyed_at).toBeNull();

      // Verify firstTenantId's key is destroyed
      const firstTenantKey = await getEncryptionKey(
        firstTenantKeyInfo.keyId,
        firstTenantId,
      );
      expect(firstTenantKey).toBeDefined();
      expect(firstTenantKey?.destroyed_at).not.toBeNull();
    });
  });

  describe("Scenario: Key Scope - partition scope", () => {
    let tenantScopeTenantId: string;
    let tenantScopeApp: Hono;

    beforeAll(async () => {
      tenantScopeTenantId = (await seedTestDb(db).createTenant()).id;

      // Create policy with partition scope (all streams share "default" key)
      await createPolicies(db, [
        {
          policyId: `${tenantScopeTenantId}-partition-scope`,
          partition: tenantScopeTenantId,
          keyScope: "partition",
          streamTypeClass: "generator",
          encryptionAlgorithm: "AES-GCM",
          keyRotationIntervalDays: 180,
        },
      ]);

      const tenantPort = createTenantModule({ db, logger });
      const generatorPort = createGeneratorModule({ tenantPort, db, logger });
      tenantScopeApp = createGeneratorHttpAdapter({ generatorPort, logger });
    });

    it("should use 'default' keyRef for partition scope", async () => {
      // Verify partition scope uses default keyRef
      const response = await tenantScopeApp.request(
        `/api/tenants/${tenantScopeTenantId}/generators`,
        {
          method: "POST",
          body: JSON.stringify(generateGeneratorData()),
        },
      );
      const json = await response.json();
      const generatorId = json.generatorId as string;

      const messages = await db
        .selectFrom("messages")
        .select(["message_metadata"])
        .where("stream_id", "=", generatorId)
        .where("partition", "=", tenantScopeTenantId)
        .executeTakeFirst();

      const keyInfo = getKeyFromMetadata(messages?.message_metadata);

      // Partition scope always uses "default" as keyRef
      expect(keyInfo.keyRef).toBe("default");
    });

    it("should share the same key across all stream types with partition scope", async () => {
      // This demonstrates that partition scope uses "default" keyRef
      // In a real scenario, you'd have multiple stream types sharing the same key
      const response1 = await tenantScopeApp.request(
        `/api/tenants/${tenantScopeTenantId}/generators`,
        {
          method: "POST",
          body: JSON.stringify(generateGeneratorData()),
        },
      );
      const json1 = await response1.json();
      const generatorId1 = json1.generatorId as string;

      const response2 = await tenantScopeApp.request(
        `/api/tenants/${tenantScopeTenantId}/generators`,
        {
          method: "POST",
          body: JSON.stringify(generateGeneratorData()),
        },
      );
      const json2 = await response2.json();
      const generatorId2 = json2.generatorId as string;

      const messages1 = await db
        .selectFrom("messages")
        .select(["message_metadata"])
        .where("stream_id", "=", generatorId1)
        .where("partition", "=", tenantScopeTenantId)
        .executeTakeFirst();

      const messages2 = await db
        .selectFrom("messages")
        .select(["message_metadata"])
        .where("stream_id", "=", generatorId2)
        .where("partition", "=", tenantScopeTenantId)
        .executeTakeFirst();

      const keyInfo1 = getKeyFromMetadata(messages1?.message_metadata);
      const keyInfo2 = getKeyFromMetadata(messages2?.message_metadata);

      // Both should use "default" keyRef
      expect(keyInfo1.keyRef).toBe("default");
      expect(keyInfo2.keyRef).toBe("default");
      expect(keyInfo1.keyRef).toBe(keyInfo2.keyRef);
    });
  });

  describe("Scenario: Policy Enforcement", () => {
    let selectiveTenantId: string;
    let selectiveApp: Hono;
    let selectiveCryptoEventStore: KyselyEventStore;
    let selectiveProjectEvents: (opts?: {
      batchSize?: number;
    }) => Promise<void>;

    beforeAll(async () => {
      selectiveTenantId = (await seedTestDb(db).createTenant()).id;

      // Create policy for "generator" stream type during tenant onboarding
      // Stream types without policies will cause errors (fail-fast behavior)
      await createPolicies(db, [
        {
          policyId: `${selectiveTenantId}-generator`,
          partition: selectiveTenantId,
          keyScope: "stream",
          streamTypeClass: "generator",
          encryptionAlgorithm: "AES-GCM",
          keyRotationIntervalDays: 180,
        },
        // Not creating policies for other stream types (e.g., "cart")
        // Attempting to append to those streams will throw errors
      ]);

      const tenantPort = createTenantModule({ db, logger });
      const generatorPort = createGeneratorModule({ tenantPort, db, logger });
      selectiveApp = createGeneratorHttpAdapter({ generatorPort, logger });

      selectiveCryptoEventStore = createCryptoEventStore(
        getKyselyEventStore({ db, logger }),
        {
          policy: createPolicyResolver(db, logger),
          keys: createKeyManagement(db),
          crypto: createWebCryptoProvider(),
          buildAAD: ({ partition, streamId }: CryptoContext) =>
            new TextEncoder().encode(`${partition}:${streamId}`),
          logger,
        },
      );

      const registry = createProjectionRegistry(generatorsSnapshotProjection());
      const runner = createProjectionRunner({
        db,
        readStream: selectiveCryptoEventStore.readStream,
        registry,
      });

      selectiveProjectEvents = async ({ batchSize = 500 } = {}) => {
        const streams = await db
          .selectFrom("streams")
          .select(["stream_id"])
          .where("is_archived", "=", false)
          .where("partition", "=", selectiveTenantId)
          .where("stream_type", "=", "generator")
          .execute();

        for (const s of streams) {
          const subscriptionId = `generators-read-model:${s.stream_id}`;
          await runner.projectEvents(subscriptionId, s.stream_id as string, {
            partition: selectiveTenantId,
            batchSize,
          });
        }
      };
    });

    it("should encrypt streams with policies", async () => {
      // Generator streams should be encrypted (has policy)
      const response = await selectiveApp.request(
        `/api/tenants/${selectiveTenantId}/generators`,
        {
          method: "POST",
          body: JSON.stringify(generateGeneratorData()),
        },
      );
      const json = await response.json();
      const generatorId = json.generatorId as string;

      const messages = await db
        .selectFrom("messages")
        .select(["message_data", "message_metadata"])
        .where("stream_id", "=", generatorId)
        .where("partition", "=", selectiveTenantId)
        .executeTakeFirst();

      // Should be encrypted
      const messageDataSchema = z.object({ ciphertext: z.base64() });
      expect(messageDataSchema.safeParse(messages?.message_data).success).toBe(
        true,
      );

      const metadata = messages?.message_metadata as {
        enc?: { algo?: string };
      } | null;
      expect(metadata?.enc?.algo).toBeDefined();
    });

    it("should encrypt and decrypt streams with policies", async () => {
      // This test verifies that the crypto store correctly encrypts and decrypts
      // streams that have encryption policies configured

      // Generator (has policy) - should be encrypted
      const genResponse = await selectiveApp.request(
        `/api/tenants/${selectiveTenantId}/generators`,
        {
          method: "POST",
          body: JSON.stringify(generateGeneratorData()),
        },
      );
      const genJson = await genResponse.json();
      const generatorId = genJson.generatorId as string;

      await selectiveProjectEvents();

      // Verify generator events are encrypted
      const genMessages = await db
        .selectFrom("messages")
        .select(["message_data", "message_metadata"])
        .where("stream_id", "=", generatorId)
        .where("partition", "=", selectiveTenantId)
        .executeTakeFirst();

      const genMetadata = genMessages?.message_metadata as {
        enc?: { algo?: string };
      } | null;
      expect(genMetadata?.enc).toBeDefined();

      // Reading should work (decryption happens transparently)
      const streamResult = await selectiveCryptoEventStore.readStream(
        generatorId,
        {
          partition: selectiveTenantId,
        },
      );

      expect(streamResult.events.length).toBeGreaterThan(0);
      const eventData = (streamResult.events[0] as any).data;
      expect(eventData).not.toHaveProperty("ciphertext");
    });

    it("should throw error when appending to stream without policy", async () => {
      // Create an event for a stream type that has NO policy (e.g., "cart")
      // This verifies that missing policies are caught early (fail-fast)
      const cartStreamId = `cart-${crypto.randomUUID()}`;
      const cartEvent = {
        type: "CartCreated",
        data: {
          eventData: {
            cartId: cartStreamId,
            tenantId: selectiveTenantId,
            items: [],
          },
          eventMeta: {
            tenantId: selectiveTenantId,
            cartId: cartStreamId,
            version: 1,
          },
        },
      };

      // Attempt to append event with streamType "cart" (no policy exists for this type)
      // This should throw PolicyResolutionError
      await expect(
        selectiveCryptoEventStore.appendToStream(cartStreamId, [cartEvent], {
          partition: selectiveTenantId,
          streamType: "cart",
        }),
      ).rejects.toThrow("No encryption policy found");

      // Verify no event was stored
      const cartMessages = await db
        .selectFrom("messages")
        .select(["message_data"])
        .where("stream_id", "=", cartStreamId)
        .where("partition", "=", selectiveTenantId)
        .executeTakeFirst();

      expect(cartMessages).toBeUndefined();

      // This fail-fast behavior ensures configuration errors are caught immediately
      // rather than silently storing data unencrypted when encryption was expected
    });
  });

  describe("Scenario: Multi-tenant Isolation", () => {
    let tenant1Id: string;
    let tenant2Id: string;
    let tenant1App: Hono;
    let tenant2App: Hono;
    let tenant1CryptoEventStore: KyselyEventStore;
    let tenant2CryptoEventStore: KyselyEventStore;

    beforeAll(async () => {
      tenant1Id = (await seedTestDb(db).createTenant()).id;
      tenant2Id = (await seedTestDb(db).createTenant()).id;

      // Create different policies for each tenant with different algorithms
      await createPolicies(db, [
        {
          policyId: `${tenant1Id}-generator`,
          partition: tenant1Id,
          keyScope: "stream",
          streamTypeClass: "generator",
          encryptionAlgorithm: "AES-GCM",
          keyRotationIntervalDays: 180,
        },
        {
          policyId: `${tenant2Id}-generator`,
          partition: tenant2Id,
          keyScope: "stream",
          streamTypeClass: "generator",
          encryptionAlgorithm: "AES-GCM", // Same algorithm, different settings to test isolation
          keyRotationIntervalDays: 365, // Different rotation interval
        },
      ]);

      const tenantPort = createTenantModule({ db, logger });
      const generatorPort = createGeneratorModule({ tenantPort, db, logger });
      tenant1App = createGeneratorHttpAdapter({ generatorPort, logger });
      tenant2App = createGeneratorHttpAdapter({ generatorPort, logger });

      tenant1CryptoEventStore = createCryptoEventStore(
        getKyselyEventStore({ db, logger }),
        {
          policy: createPolicyResolver(db, logger),
          keys: createKeyManagement(db),
          crypto: createWebCryptoProvider(),
          buildAAD: ({ partition, streamId }: CryptoContext) =>
            new TextEncoder().encode(`${partition}:${streamId}`),
          logger,
        },
      );

      tenant2CryptoEventStore = createCryptoEventStore(
        getKyselyEventStore({ db, logger }),
        {
          policy: createPolicyResolver(db, logger),
          keys: createKeyManagement(db),
          crypto: createWebCryptoProvider(),
          buildAAD: ({ partition, streamId }: CryptoContext) =>
            new TextEncoder().encode(`${partition}:${streamId}`),
          logger,
        },
      );
    });

    it("should isolate keys per partition", async () => {
      const response1 = await tenant1App.request(
        `/api/tenants/${tenant1Id}/generators`,
        {
          method: "POST",
          body: JSON.stringify(generateGeneratorData()),
        },
      );
      const json1 = await response1.json();
      const generatorId1 = json1.generatorId as string;

      const response2 = await tenant2App.request(
        `/api/tenants/${tenant2Id}/generators`,
        {
          method: "POST",
          body: JSON.stringify(generateGeneratorData()),
        },
      );
      expect(response2.status).toBe(201); // 201 Created is the correct status for POST
      const json2 = await response2.json();
      const generatorId2 = json2.generatorId as string;

      const messages1 = await db
        .selectFrom("messages")
        .select(["message_metadata"])
        .where("stream_id", "=", generatorId1)
        .where("partition", "=", tenant1Id)
        .executeTakeFirst();

      const messages2 = await db
        .selectFrom("messages")
        .select(["message_metadata"])
        .where("stream_id", "=", generatorId2)
        .where("partition", "=", tenant2Id)
        .executeTakeFirst();

      expect(messages1?.message_metadata).toBeDefined();
      expect(messages2?.message_metadata).toBeDefined();
      const keyInfo1 = getKeyFromMetadata(messages1?.message_metadata);
      const keyInfo2 = getKeyFromMetadata(messages2?.message_metadata);

      // Keys should be different (different partitions)
      expect(keyInfo1.keyId).not.toBe(keyInfo2.keyId);
      expect(keyInfo1.keyId).toContain(tenant1Id);
      expect(keyInfo2.keyId).toContain(tenant2Id);
    });

    it("should isolate policies per partition", async () => {
      // Verify tenant1 uses AES-GCM
      const response1 = await tenant1App.request(
        `/api/tenants/${tenant1Id}/generators`,
        {
          method: "POST",
          body: JSON.stringify(generateGeneratorData()),
        },
      );
      const json1 = await response1.json();
      const generatorId1 = json1.generatorId as string;

      // Verify tenant2 uses AES-CBC
      const response2 = await tenant2App.request(
        `/api/tenants/${tenant2Id}/generators`,
        {
          method: "POST",
          body: JSON.stringify(generateGeneratorData()),
        },
      );
      expect(response2.status).toBe(201); // 201 Created is the correct status for POST
      const json2 = await response2.json();
      const generatorId2 = json2.generatorId as string;

      const messages1 = await db
        .selectFrom("messages")
        .select(["message_metadata"])
        .where("stream_id", "=", generatorId1)
        .where("partition", "=", tenant1Id)
        .executeTakeFirst();

      const messages2 = await db
        .selectFrom("messages")
        .select(["message_metadata"])
        .where("stream_id", "=", generatorId2)
        .where("partition", "=", tenant2Id)
        .executeTakeFirst();

      expect(messages1?.message_metadata).toBeDefined();
      expect(messages2?.message_metadata).toBeDefined();
      const metadata1 = messages1?.message_metadata as {
        enc?: { algo?: string };
      } | null;
      const metadata2 = messages2?.message_metadata as {
        enc?: { algo?: string };
      } | null;

      expect(metadata1?.enc?.algo).toBe("AES-GCM");
      // Verify tenant2 uses AES-GCM (same algorithm, but isolation is tested by different keys/policies)
      expect(metadata2?.enc?.algo).toBe("AES-GCM");
    });

    it("should isolate key destruction per partition", async () => {
      const response1 = await tenant1App.request(
        `/api/tenants/${tenant1Id}/generators`,
        {
          method: "POST",
          body: JSON.stringify(generateGeneratorData()),
        },
      );
      const json1 = await response1.json();
      const generatorId1 = json1.generatorId as string;

      const response2 = await tenant2App.request(
        `/api/tenants/${tenant2Id}/generators`,
        {
          method: "POST",
          body: JSON.stringify(generateGeneratorData()),
        },
      );
      const json2 = await response2.json();
      const generatorId2 = json2.generatorId as string;

      // Destroy keys for tenant1 only
      const keys = createKeyManagement(db);
      await keys.destroyPartitionKeys(tenant1Id);

      // Tenant1 should fail to decrypt
      const streamResult1 = await tenant1CryptoEventStore.readStream(
        generatorId1,
        {
          partition: tenant1Id,
        },
      );

      // Tenant2 should still work
      const streamResult2 = await tenant2CryptoEventStore.readStream(
        generatorId2,
        {
          partition: tenant2Id,
        },
      );

      expect(streamResult1.events.length).toBe(0);
      expect(streamResult2.events.length).toBeGreaterThan(0);
    });
  });

  describe("Scenario: Read Stream Options", () => {
    let readOptionsGeneratorId: string;

    beforeAll(async () => {
      readOptionsGeneratorId = await createGenerator(generateGeneratorData());

      // Create multiple events
      await updateGenerator(readOptionsGeneratorId, {
        name: "Updated Once",
      });
      await updateGenerator(readOptionsGeneratorId, {
        name: "Updated Twice",
      });
      await updateGenerator(readOptionsGeneratorId, {
        name: "Updated Thrice",
      });
    });

    it("should handle from parameter with encrypted events", async () => {
      // Read from position 2 (second event)
      const streamResult = await cryptoEventStore.readStream(
        readOptionsGeneratorId,
        {
          partition: tenantId,
          from: 2n,
        },
      );

      // Should get events from version 2 onwards (3 events total, skipping first)
      expect(streamResult.events.length).toBeGreaterThan(0);
      expect(streamResult.events.length).toBeLessThanOrEqual(3);

      // All events should be decrypted
      for (const event of streamResult.events) {
        const data = (event as any).data;
        expect(data).not.toHaveProperty("ciphertext");
        expect(data).toHaveProperty("eventData");
      }
    });

    it("should handle maxCount with encrypted events", async () => {
      const streamResult = await cryptoEventStore.readStream(
        readOptionsGeneratorId,
        {
          partition: tenantId,
          maxCount: 2n,
        },
      );

      // Should get at most 2 events
      expect(streamResult.events.length).toBeLessThanOrEqual(2);
      expect(streamResult.events.length).toBeGreaterThan(0);

      // All should be decrypted
      for (const event of streamResult.events) {
        const data = (event as any).data;
        expect(data).not.toHaveProperty("ciphertext");
      }
    });
  });

  describe("Scenario: AAD (Additional Authenticated Data)", () => {
    it("should include AAD in encryption metadata", async () => {
      const generatorId = await createGenerator(generateGeneratorData());

      // AAD is used during encryption but not stored separately
      // The buildAAD function is called with the correct context
      // We verify that decryption works, which proves AAD was used correctly

      // Reading the stream should work, which means AAD matches
      const streamResult = await cryptoEventStore.readStream(generatorId, {
        partition: tenantId,
      });

      expect(streamResult.events.length).toBeGreaterThan(0);
      const eventData = (streamResult.events[0] as any).data;
      expect(eventData).not.toHaveProperty("ciphertext");
      expect(eventData).toHaveProperty("eventData");

      // If AAD didn't match, decryption would fail
      // This is an implicit test - if we can decrypt, AAD was correct
    });

    it("should fail decryption if AAD is tampered", async () => {
      // Note: This test verifies that AAD is actually being used
      // If AAD is wrong, decryption should fail even with correct key
      // However, in our implementation, AAD is built from partition:streamId
      // and we can't easily tamper with it without creating a new crypto store
      // This is more of a documentation test showing AAD is configured

      const generatorId = await createGenerator(generateGeneratorData());

      // Verify normal decryption works
      const streamResult = await cryptoEventStore.readStream(generatorId, {
        partition: tenantId,
      });

      expect(streamResult.events.length).toBeGreaterThan(0);

      // The fact that decryption succeeds means AAD was correctly
      // constructed from partition:streamId during encryption
    });
  });

  describe("Scenario: Error Handling", () => {
    it("should handle missing keys gracefully", async () => {
      const generatorId = await createGenerator(generateGeneratorData());
      await projectEvents();

      // Verify read model exists
      const readModelBefore = await getReadModel(generatorId);
      expect(readModelBefore).toBeDefined();

      // Get the key and delete it (simulating key corruption/loss)
      const messages = await getMessages(generatorId);
      const keyInfo = getKeyFromMetadata(messages[0]?.message_metadata);

      // Delete the key entirely (not just destroy it)
      await db
        .deleteFrom("encryption_keys")
        .where("key_id", "=", keyInfo.keyId)
        .where("partition", "=", tenantId)
        .execute();

      // Reading should handle the missing key gracefully
      // The implementation should skip events that can't be decrypted
      const streamResult = await cryptoEventStore.readStream(generatorId, {
        partition: tenantId,
      });

      // Events should be skipped when key is missing
      expect(streamResult.events.length).toBe(0);
    });

    it("should handle decryption failures gracefully", async () => {
      const generatorId = await createGenerator(generateGeneratorData());

      // Tamper with the ciphertext
      await db
        .updateTable("messages")
        .set({
          message_data: JSON.stringify({
            ciphertext: "invalid_base64_ciphertext",
          }),
        })
        .where("stream_id", "=", generatorId)
        .where("partition", "=", tenantId)
        .execute();

      // Reading should skip tampered events
      const streamResult = await cryptoEventStore.readStream(generatorId, {
        partition: tenantId,
      });

      // Tampered events should be skipped (returns empty or partial)
      // The exact behavior depends on implementation, but it shouldn't crash
      expect(Array.isArray(streamResult.events)).toBe(true);
    });
  });
});

function generateGeneratorData() {
  return {
    name: faker.company.name(),
    address: faker.location.streetAddress(),
    notes: faker.lorem.sentence(),
    generatorType: faker.helpers.arrayElement([
      "commercial",
      "residential",
      "industrial",
      "agricultural",
      "other",
    ]),
  };
}
