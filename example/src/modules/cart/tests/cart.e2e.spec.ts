import {
  createProjectionRegistry,
  createProjectionRunner,
  createSnapshotProjectionRegistry,
  getKyselyEventStore,
  type ProjectionEvent,
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
  cartsSnapshotProjection,
  createCartHttpAdapter,
  createCartModule,
} from "../cart.index.js";
import {
  initialState as cartInitialState,
  createEvolve,
  type CartDomainEvent,
  type CartDomainState,
} from "../application/event-sourcing/cart.event-handler.js";

describe("Cart Integration", () => {
  const TEST_DB_NAME = "cart_e2e_test";
  const logger = {
    info: vi.fn(),
    error: vi.fn(),
  } as Pick<Logger, "info" | "error"> as Logger;

  let app: Hono;
  let db: DatabaseExecutor;
  let tenantId: string;
  let project: (opts?: { batchSize?: number }) => Promise<void>;

  beforeAll(async () => {
    db = await createTestDb(TEST_DB_NAME);
    const tenantPort = createTenantModule({ db, logger });
    const cartPort = createCartModule({ tenantPort, db, logger });
    app = createCartHttpAdapter({ cartPort, logger });
    tenantId = (await seedTestDb(db).createTenant()).id;

    const { readStream } = getKyselyEventStore({ db, logger });
    const registry = createProjectionRegistry(cartsSnapshotProjection());
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
        .where("stream_type", "=", "cart")
        .execute();
      for (const s of streams) {
        const streamId = s.stream_id as string;
        const subscriptionId = `carts-read-model:${streamId}`;
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

  it("should create a cart", async () => {
    const data = generateCartData();
    const response = await app.request(`/api/tenants/${tenantId}/carts`, {
      method: "POST",
      body: JSON.stringify(data),
    });
    expect(response.status).toBe(201);
  });

  describe("should add and remove items", () => {
    let cartId: string;
    beforeAll(async () => {
      const resp = await app.request(`/api/tenants/${tenantId}/carts`, {
        method: "POST",
        body: JSON.stringify(generateCartData()),
      });
      const json = await resp.json();
      cartId = json.cartId;
      // ensure stream exists and is visible to read model
      await project();
    });

    it("adds an item", async () => {
      expect(z.uuid().safeParse(cartId).success).toBe(true);
      const response = await app.request(
        `/api/tenants/${tenantId}/carts/${cartId}/items`,
        {
          method: "PUT",
          body: JSON.stringify({ action: "add", item: generateItem() }),
        },
      );
      expect(response.status).toBe(201);
    });

    it("removes an item", async () => {
      await app.request(`/api/tenants/${tenantId}/carts/${cartId}/items`, {
        method: "PUT",
        body: JSON.stringify({ action: "add", item: generateItem() }),
      });
      await project();
      const response = await app.request(
        `/api/tenants/${tenantId}/carts/${cartId}/items`,
        {
          method: "PUT",
          body: JSON.stringify({
            action: "remove",
            sku: "SKU-123",
            quantity: 1,
          }),
        },
      );
      expect(response.status).toBe(201);
    });
  });

  describe("should checkout and cancel", () => {
    let cartId: string;
    beforeAll(async () => {
      const resp = await app.request(`/api/tenants/${tenantId}/carts`, {
        method: "POST",
        body: JSON.stringify(generateCartData()),
      });
      const json = await resp.json();
      cartId = json.cartId;
      await app.request(`/api/tenants/${tenantId}/carts/${cartId}/items`, {
        method: "PUT",
        body: JSON.stringify({ action: "add", item: generateItem() }),
      });
      await project();
    });

    it("checks out", async () => {
      const response = await app.request(
        `/api/tenants/${tenantId}/carts/${cartId}/checkout`,
        {
          method: "PUT",
        },
      );
      expect(response.status).toBe(201);
    });

    it("cancels", async () => {
      const resp = await app.request(`/api/tenants/${tenantId}/carts`, {
        method: "POST",
        body: JSON.stringify(generateCartData()),
      });
      const json = await resp.json();
      const anotherCart = json.cartId;
      await project();
      const response = await app.request(
        `/api/tenants/${tenantId}/carts/${anotherCart}/cancel`,
        {
          method: "PUT",
          body: JSON.stringify({ reason: "Customer requested" }),
        },
      );
      expect(response.status).toBe(201);
    });
  });

  describe("should read a cart via read model", () => {
    let cartId: string;
    beforeAll(async () => {
      const resp = await app.request(`/api/tenants/${tenantId}/carts`, {
        method: "POST",
        body: JSON.stringify(generateCartData()),
      });
      const json = await resp.json();
      cartId = json.cartId;
      await app.request(`/api/tenants/${tenantId}/carts/${cartId}/items`, {
        method: "PUT",
        body: JSON.stringify({ action: "add", item: generateItem() }),
      });
      await project();
    });

    it("returns the cart from read model", async () => {
      const response = await app.request(
        `/api/tenants/${tenantId}/carts/${cartId}`,
        {
          method: "GET",
        },
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.cartId).toEqual(cartId); // API now returns camelCase
    });
  });

  describe("shopping cart scenario", () => {
    it("projects the expected read model after item ops and checkout", async () => {
      // 1) Create cart
      const resp = await app.request(`/api/tenants/${tenantId}/carts`, {
        method: "POST",
        body: JSON.stringify(generateCartData()),
      });
      const { cartId } = (await resp.json()) as { cartId: string };
      expect(z.uuid().safeParse(cartId).success).toBe(true);
      await project();

      // 2) Add SKU-123 x2 @ $25
      await app.request(`/api/tenants/${tenantId}/carts/${cartId}/items`, {
        method: "PUT",
        body: JSON.stringify({
          action: "add",
          item: {
            sku: "SKU-123",
            name: "Item 123",
            unitPrice: 25,
            quantity: 2,
          },
        }),
      });

      // 3) Add SKU-456 x1 @ $15
      await app.request(`/api/tenants/${tenantId}/carts/${cartId}/items`, {
        method: "PUT",
        body: JSON.stringify({
          action: "add",
          item: {
            sku: "SKU-456",
            name: "Item 456",
            unitPrice: 15,
            quantity: 1,
          },
        }),
      });

      await project();

      // 4) Remove SKU-123 x1
      await app.request(`/api/tenants/${tenantId}/carts/${cartId}/items`, {
        method: "PUT",
        body: JSON.stringify({ action: "remove", sku: "SKU-123", quantity: 1 }),
      });

      await project();

      // 5) Checkout
      const checkout = await app.request(
        `/api/tenants/${tenantId}/carts/${cartId}/checkout`,
        {
          method: "PUT",
        },
      );
      expect(checkout.status).toBe(201);

      await project();

      // Verify read model directly from DB to avoid driver JSON nuances
      const row = await db
        .selectFrom("carts")
        .select([
          "cart_id",
          "currency",
          "items_json",
          "total",
          "order_id",
          "is_checked_out",
          "is_cancelled",
        ])
        .where("tenant_id", "=", tenantId)
        .where("cart_id", "=", cartId)
        .executeTakeFirstOrThrow();
      const items = row.items_json as Array<{
        sku: string;
        unitPrice: number;
        quantity: number;
      }>;

      const sku123 = items.find((i) => i.sku === "SKU-123");
      const sku456 = items.find((i) => i.sku === "SKU-456");
      expect(sku123?.quantity).toBe(1);
      expect(sku123?.unitPrice).toBe(25);
      expect(sku456?.quantity).toBe(1);
      expect(sku456?.unitPrice).toBe(15);
      expect(row.currency).toBe("USD");
      expect(row.total).toBe(40);
      expect(typeof row.order_id).toBe("string");
      expect(row.order_id!.length).toBeGreaterThan(0);
      expect(row.is_checked_out).toBe(true);
      expect(row.is_cancelled).toBe(false);
    });
  });

  describe("mapToColumns call count verification", () => {
    it("should call mapToColumns exactly once per update event (not create)", async () => {
      const mockMapToColumns = vi.fn((state: CartDomainState) => {
        // Use the same logic as the real mapToColumns for consistency
        if (state.status === "init") {
          return {
            currency: null,
            total: null,
            order_id: null,
            items_json: JSON.stringify([]),
            is_checked_out: false,
            is_cancelled: false,
          };
        }
        return {
          currency: state.currency,
          total: state.status === "checkedOut" ? state.total : null,
          order_id: state.status === "checkedOut" ? state.orderId : null,
          items_json: JSON.stringify(state.items),
          is_checked_out: state.status === "checkedOut",
          is_cancelled: state.status === "cancelled",
        };
      });

      // Create a custom projection with spyable mapToColumns
      const domainEvolve = createEvolve();
      const evolve = (
        state: CartDomainState,
        event: ProjectionEvent<CartDomainEvent>,
      ): CartDomainState => {
        return domainEvolve(state, event);
      };

      const testRegistry = createSnapshotProjectionRegistry<
        CartDomainState,
        "carts",
        CartDomainEvent
      >(
        [
          "CartCreated",
          "ItemAddedToCart",
          "ItemRemovedFromCart",
          "CartEmptied",
          "CartCheckedOut",
          "CartCancelled",
        ],
        {
          tableName: "carts",
          extractKeys: (
            event: ProjectionEvent<CartDomainEvent>,
            partition: string,
          ) => {
            return {
              tenant_id: event.data.eventMeta.tenantId,
              cart_id: event.data.eventMeta.cartId,
              partition,
            };
          },
          evolve,
          initialState: cartInitialState,
          mapToColumns: mockMapToColumns,
        },
      );

      // Use existing database setup but with custom projection registry
      const { readStream } = getKyselyEventStore({ db, logger });
      const testRunner = createProjectionRunner({
        db,
        readStream,
        registry: testRegistry,
      });

      const testProject = async ({ batchSize = 500 } = {}) => {
        const streams = await db
          .selectFrom("streams")
          .select(["stream_id"])
          .where("is_archived", "=", false)
          .where("partition", "=", tenantId)
          .where("stream_type", "=", "cart")
          .execute();
        for (const s of streams) {
          const streamId = s.stream_id as string;
          const subscriptionId = `carts-read-model-test:${streamId}`;
          await testRunner.projectEvents(subscriptionId, streamId, {
            partition: tenantId,
            batchSize,
          });
        }
      };

      // 1) Create cart (this is a CREATE event - mapToColumns called once)
      const createResp = await app.request(`/api/tenants/${tenantId}/carts`, {
        method: "POST",
        body: JSON.stringify(generateCartData()),
      });
      const { cartId } = (await createResp.json()) as { cartId: string };
      await testProject();

      // Verify mapToColumns was called once for the create event
      expect(mockMapToColumns).toHaveBeenCalledTimes(1);

      // 2) Add first item (this is an UPDATE event - mapToColumns called once more)
      await app.request(`/api/tenants/${tenantId}/carts/${cartId}/items`, {
        method: "PUT",
        body: JSON.stringify({
          action: "add",
          item: { sku: "SKU-1", name: "Item 1", unitPrice: 10, quantity: 1 },
        }),
      });
      await testProject();

      // Should be called 2 times total (1 create + 1 update)
      expect(mockMapToColumns).toHaveBeenCalledTimes(2);

      // 3) Add second item (another UPDATE event - mapToColumns called once more)
      await app.request(`/api/tenants/${tenantId}/carts/${cartId}/items`, {
        method: "PUT",
        body: JSON.stringify({
          action: "add",
          item: { sku: "SKU-2", name: "Item 2", unitPrice: 20, quantity: 1 },
        }),
      });
      await testProject();

      // Should be called 3 times total (1 create + 2 updates)
      expect(mockMapToColumns).toHaveBeenCalledTimes(3);

      // 4) Remove an item (another UPDATE event - mapToColumns called once more)
      await app.request(`/api/tenants/${tenantId}/carts/${cartId}/items`, {
        method: "PUT",
        body: JSON.stringify({
          action: "remove",
          sku: "SKU-1",
          quantity: 1,
        }),
      });
      await testProject();

      // Should be called 4 times total (1 create + 3 updates)
      expect(mockMapToColumns).toHaveBeenCalledTimes(4);

      // Verify each call received the correct state
      const calls = mockMapToColumns.mock.calls;
      expect(calls.length).toBe(4);

      // First call (create) should have initial state after CartCreated
      expect(calls[0][0].status).toBe("active");
      expect(calls[0][0].items).toEqual([]);

      // Second call (first update) should have one item
      expect(calls[1][0].status).toBe("active");
      expect(calls[1][0].items).toHaveLength(1);

      // Third call (second update) should have two items
      expect(calls[2][0].status).toBe("active");
      expect(calls[2][0].items).toHaveLength(2);

      // Fourth call (third update) should have one item after removal
      expect(calls[3][0].status).toBe("active");
      expect(calls[3][0].items).toHaveLength(1);
    });
  });
});

function generateCartData() {
  return {
    currency: "USD",
  };
}

function generateItem() {
  return {
    sku: "SKU-123",
    name: "Test Item",
    unitPrice: 25,
    quantity: 1,
  };
}
