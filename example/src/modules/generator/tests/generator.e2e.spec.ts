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
} from "@wataruoguchi/emmett-event-store-kysely";
import type { Hono } from "hono";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
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
import type { GeneratorPort } from "../generator.module.js";

describe("Generator Integration", () => {
  const TEST_DB_NAME = "generator_e2e_test";
  const logger = {
    info: vi.fn(),
    // info: console.log, // Debugging
    error: vi.fn(),
  } as unknown as Logger;

  let app: Hono;
  let db: DatabaseExecutor;
  let tenantId: string;
  let project: (opts?: { batchSize?: number }) => Promise<void>;

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

    // Projection runner (in-test integration of the worker)
    const { readStream } = createCryptoEventStore(
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
      readStream,
      registry,
    });
    project = async ({ batchSize = 500 } = {}) => {
      const streams = await db
        .selectFrom("streams")
        .select(["stream_id"])
        .where("is_archived", "=", false)
        .where("partition", "=", tenantId)
        .where("stream_type", "=", "generator")
        .execute();
      for (const s of streams) {
        const streamId = s.stream_id as string;
        const subscriptionId = `generators-read-model:${streamId}`;
        await runner.projectEvents(subscriptionId, streamId, {
          partition: tenantId,
          batchSize,
        });
      }
    };
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("should create a generator", async () => {
    const generatorData = generateGeneratorData();
    expect(tenantId).toBeDefined();
    expect(generatorData).toBeDefined();
    const response = await app.request(`/api/tenants/${tenantId}/generators`, {
      method: "POST",
      body: JSON.stringify(generatorData),
    });
    expect(response.status).toBe(201);
  });

  describe("should update a generator", () => {
    let generatorId: string;
    beforeEach(async () => {
      const generatorData = generateGeneratorData();
      const response = await app.request(
        `/api/tenants/${tenantId}/generators`,
        {
          method: "POST",
          body: JSON.stringify(generatorData),
        },
      );
      const json = await response.json();
      generatorId = json.generatorId;
      await project();
    });

    it("should update a generator", async () => {
      expect(generatorId).toBeDefined();
      expect(z.uuid().safeParse(generatorId).success).toBe(true);

      const response = await app.request(
        `/api/tenants/${tenantId}/generators/${generatorId}`,
        {
          method: "PUT",
          body: JSON.stringify({
            isDeleted: false,
            name: "Updated Generator",
          }),
        },
      );
      expect(response.status).toBe(201);
    });

    it("should delete a generator", async () => {
      const response = await app.request(
        `/api/tenants/${tenantId}/generators/${generatorId}`,
        {
          method: "PUT",
          body: JSON.stringify({
            isDeleted: true,
          }),
        },
      );
      expect(response.status).toBe(201);
    });
  });

  describe("should get a generator by id", () => {
    let generatorId: string;
    beforeAll(async () => {
      const generatorData = generateGeneratorData();
      const response = await app.request(
        `/api/tenants/${tenantId}/generators`,
        {
          method: "POST",
          body: JSON.stringify(generatorData),
        },
      );
      const json = await response.json();
      generatorId = json.generatorId;
      await project();
    });

    it("should get a generator by id", async () => {
      const response = await app.request(
        `/api/tenants/${tenantId}/generators/${generatorId}`,
        {
          method: "GET",
        },
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.generatorId).toEqual(generatorId); // API now returns camelCase
    });
  });

  describe("should get a deleted generator by id", () => {
    let generatorId: string;
    beforeAll(async () => {
      await (async function createGenerator() {
        const generatorData = generateGeneratorData();
        const response = await app.request(
          `/api/tenants/${tenantId}/generators`,
          {
            method: "POST",
            body: JSON.stringify(generatorData),
          },
        );
        const json = await response.json();
        generatorId = json.generatorId;
      })();
      await (async function updateGenerator() {
        await app.request(
          `/api/tenants/${tenantId}/generators/${generatorId}`,
          {
            method: "PUT",
            body: JSON.stringify({ name: "It will be deleted" }),
          },
        );
      })();
      await project();
      await (async function deleteGenerator() {
        await app.request(
          `/api/tenants/${tenantId}/generators/${generatorId}`,
          {
            method: "PUT",
            body: JSON.stringify({ isDeleted: true }),
          },
        );
      })();
      await project();
    });

    it("should get a generator by id", async () => {
      const response = await app.request(
        `/api/tenants/${tenantId}/generators/${generatorId}`,
        {
          method: "GET",
        },
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.generatorId).toEqual(generatorId); // API now returns camelCase
      // Note: is_deleted should also be camelCase but we need to check the entity mapping
    });
  });

  describe("should list generators for tenant", () => {
    let generatorId: string;
    beforeAll(async () => {
      const generatorData = generateGeneratorData();
      const response = await app.request(
        `/api/tenants/${tenantId}/generators`,
        {
          method: "POST",
          body: JSON.stringify(generatorData),
        },
      );
      const json = await response.json();
      generatorId = json.generatorId;
      await project();
    });

    it("should return at least one generator for tenant", async () => {
      const response = await app.request(
        `/api/tenants/${tenantId}/generators`,
        {
          method: "GET",
        },
      );
      expect(response.status).toBe(200);
      // Type Declaration should come from the interface, not the implementation.
      const list = (await response.json()) as Awaited<
        ReturnType<GeneratorPort["findAllByTenant"]>
      >;
      expect(Array.isArray(list)).toBe(true);
      expect(list.some((g) => g && g.generatorId === generatorId)).toBe(true);
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
