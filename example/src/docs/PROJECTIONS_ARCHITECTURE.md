# Projections Architecture

This document explains how projections work in this event-sourced application and the distinction between **snapshot projections** (recommended), **projection runners**, and **consumers**.

## Quick Overview

| Component | Purpose | Use When |
|-----------|---------|----------|
| **Snapshot Projection** | Define how events → state | Always (recommended approach) |
| **Projection Runner** | Execute projections on-demand | Testing, backfills |
| **Consumer** | Execute projections continuously | Production |

## 1. Snapshot Projections (Recommended) ⭐

### What It Is

A **snapshot projection** stores the complete aggregate state in a JSONB column by reusing your write model's `evolve` function.

**Key Innovation:** Same `evolve` logic for writes AND reads!

```typescript
// cart.event-handler.ts (Write Model)
export function createEvolve() {
  return (state: CartDomainState, event: CartDomainEvent): CartDomainState => {
    switch (event.type) {
      case "CartCreated":
        return { status: "active", cartId: event.data.cartId, items: [] };
      case "ItemAdded":
        return { ...state, items: [...state.items, event.data.item] };
      // ...
    }
  };
}

// cart.read-model.ts (Read Model)
import { createSnapshotProjectionRegistry } from "@wataruoguchi/emmett-event-store-kysely/projections";

export function cartsSnapshotProjection() {
  const domainEvolve = createEvolve(); // Reuse!
  
  return createSnapshotProjectionRegistry<CartDomainState, "carts", CartDomainEvent>(
    ["CartCreated", "ItemAdded", "CartCheckedOut"],
    {
      tableName: "carts",
      extractKeys: (event, partition) => ({
        tenant_id: event.data.eventMeta.tenantId,
        cart_id: event.data.eventMeta.cartId,
        partition,
      }),
      evolve: (state, event) => domainEvolve(state, event), // Same logic!
      initialState,
      mapToColumns: (state) => ({  // Optional: denormalize for queries
        currency: state.status !== "init" ? state.currency : null,
        total: state.status === "checkedOut" ? state.total : null,
      }),
    }
  );
}
```

### Benefits

✅ **Consistency** - Same logic as write model  
✅ **No Schema Migrations** - Add fields without DB changes  
✅ **Less Code** - No manual field mapping  
✅ **Complete State** - Full aggregate always available  
✅ **Optional Denormalization** - Extract fields for queries

### Database Table

```sql
CREATE TABLE carts (
  tenant_id VARCHAR(100) NOT NULL,
  cart_id VARCHAR(100) NOT NULL,
  partition VARCHAR(100) NOT NULL,
  
  -- Required: Complete state
  snapshot JSONB NOT NULL,
  
  -- Required: Tracking
  stream_id VARCHAR(255) NOT NULL,
  last_stream_position BIGINT NOT NULL,
  last_global_position BIGINT NOT NULL,
  
  -- Optional: Denormalized for queries
  currency VARCHAR(3),
  total NUMERIC(10, 2),
  is_checked_out BOOLEAN,
  
  PRIMARY KEY (tenant_id, cart_id, partition)
);
```

### How It Works

```
┌─────────────┐
│   Event     │
│ CartCreated │
└──────┬──────┘
       │
       ↓
┌──────────────────┐
│ Load Snapshot    │ ← Read existing snapshot from DB
│ (if exists)      │   or use initialState()
└──────┬───────────┘
       │
       ↓
┌──────────────────┐
│ Apply Evolve     │ ← newState = evolve(currentState, event)
└──────┬───────────┘
       │
       ↓
┌──────────────────┐
│ Save Snapshot    │ ← UPDATE snapshot = JSON.stringify(newState)
│ + Denormalized   │   + optional denormalized columns
└──────────────────┘
```

---

## 2. Projection Runner

### What It Is

The **projection runner** executes projections **on-demand** and **synchronously**.

**Use for:** Tests, backfills, manual control

### Example

```typescript
import {
  createProjectionRunner,
  createProjectionRegistry,
} from "@wataruoguchi/emmett-event-store-kysely/projections";
import { getKyselyEventStore } from "@wataruoguchi/emmett-event-store-kysely";

// In test setup
const eventStore = getKyselyEventStore({ db, logger });
const registry = createProjectionRegistry(cartsSnapshotProjection());
const runner = createProjectionRunner({ 
  db, 
  readStream: eventStore.readStream, 
  registry 
});

// In test
it("should create cart", async () => {
  // 1. Execute command
  await cartService.create({ tenantId, cartId, currency: "USD" });
  
  // 2. Project events synchronously
  await runner.projectEvents("subscription-id", cartId, {
    partition: tenantId,
  });
  
  // 3. Verify read model
  const cart = await db
    .selectFrom("carts")
    .where("cart_id", "=", cartId)
    .executeTakeFirstOrThrow();
  
  expect(cart.currency).toBe("USD");
});
```

### Characteristics

- ✅ **Synchronous** - Immediate execution
- ✅ **Deterministic** - You control when it runs
- ✅ **Fast** - No polling delays
- ✅ **Simple** - Easy to use in tests

---

## 3. Consumer (For Production)

### What It Is

A **consumer** continuously polls for new events and applies projections **automatically**.

**Use for:** Production, background workers, real-time updates

### Example

```typescript
import { createKyselyEventStoreConsumer } from "@wataruoguchi/emmett-event-store-kysely";

export function createCartsConsumer({
  db,
  logger,
  partition,
  consumerName = "carts-read-model",
}) {
  const consumer = createKyselyEventStoreConsumer({
    db,
    logger,
    consumerName,
    batchSize: 100,
    pollingInterval: 1000, // Poll every 1 second
  });

  // Get snapshot projection registry
  const registry = cartsSnapshotProjection();

  // Subscribe to all events in the registry
  for (const [eventType, handlers] of Object.entries(registry)) {
    for (const handler of handlers) {
      consumer.subscribe(
        async (event) => {
          // Convert consumer event format to projection event format
          const projectionEvent = {
            type: event.type,
            data: event.data,
            metadata: {
              streamId: event.metadata.streamName,
              streamPosition: event.metadata.streamPosition,
              globalPosition: event.metadata.globalPosition,
            },
          };

          await handler({ db, partition }, projectionEvent);
        },
        eventType
      );
    }
  }

  return consumer;
}

// Usage
const consumer = createCartsConsumer({ db, logger, partition: "tenant-123" });
await consumer.start();

// Later, stop gracefully
await consumer.stop();
```

### Characteristics

- ✅ **Automatic** - Continuously processes events
- ✅ **Checkpoint Tracking** - Resumes from last position
- ✅ **Production-Ready** - Handles errors, batching
- ⚠️ **Asynchronous** - Not instant (polling interval)

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    Event Store                          │
│          (messages, streams, subscriptions)             │
└──────────────────────┬──────────────────────────────────┘
                       │
                       │ Events written
                       │
          ┌────────────┴────────────┐
          │                         │
          │                         │
     ┌────▼────┐               ┌────▼────────┐
     │  Tests  │               │ Production  │
     └────┬────┘               └────┬────────┘
          │                         │
          │                         │
     ┌────▼──────────────┐     ┌────▼─────────────────┐
     │ Projection Runner │     │     Consumer         │
     │                   │     │                      │
     │ On-demand         │     │ Continuous polling   │
     │ Synchronous       │     │ Automatic            │
     └────┬──────────────┘     └────┬─────────────────┘
          │                         │
          │                         │
          └─────────┬───────────────┘
                    │
                    │ Both use
                    │
          ┌─────────▼──────────────┐
          │ Snapshot Projection    │
          │  Registry              │
          │                        │
          │ • Event → Handler map  │
          │ • Reuses evolve()      │
          │ • Stores snapshot      │
          └─────────┬──────────────┘
                    │
                    │
          ┌─────────▼──────────┐
          │   Read Model       │
          │   (carts table)    │
          │                    │
          │ • snapshot (JSONB) │
          │ • denormalized cols│
          └────────────────────┘
```

---

## Usage Patterns

### Pattern 1: Testing with Projection Runner

```typescript
describe("Cart E2E Tests", () => {
  let runner: ReturnType<typeof createProjectionRunner>;
  let project: () => Promise<void>;

  beforeAll(async () => {
    const eventStore = getKyselyEventStore({ db, logger });
    const registry = createProjectionRegistry(cartsSnapshotProjection());
    runner = createProjectionRunner({ 
      db, 
      readStream: eventStore.readStream, 
      registry 
    });
    
    project = async () => {
      const streams = await db
        .selectFrom("streams")
        .select(["stream_id"])
        .where("partition", "=", tenantId)
        .execute();
        
      for (const s of streams) {
        await runner.projectEvents(
          `subscription-${s.stream_id}`,
          s.stream_id,
          { partition: tenantId }
        );
      }
    };
  });

  it("should create cart", async () => {
    await cartService.create({ tenantId, cartId, currency: "USD" });
    await project();  // Synchronous projection
    
    const cart = await db
      .selectFrom("carts")
      .where("cart_id", "=", cartId)
      .executeTakeFirstOrThrow();
    
    expect(cart.currency).toBe("USD");
    
    // Access full state from snapshot
    const state = cart.snapshot as CartDomainState;
    expect(state.status).toBe("active");
    expect(state.items).toHaveLength(0);
  });
});
```

### Pattern 2: Production with Consumer

```typescript
// In projection-worker.ts
async function startConsumers() {
  const tenants = await db
    .selectFrom("tenants")
    .select("tenant_id")
    .where("is_active", "=", true)
    .execute();

  const consumers = [];
  
  for (const tenant of tenants) {
    const consumer = createCartsConsumer({
      db,
      logger,
      partition: tenant.tenant_id,
      consumerName: `carts-${tenant.tenant_id}`,
      batchSize: 100,
      pollingInterval: 1000,
    });
    
    await consumer.start();
    consumers.push(consumer);
  }

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    logger.info("Shutting down consumers...");
    for (const consumer of consumers) {
      await consumer.stop();
    }
    process.exit(0);
  });

  return consumers;
}
```

---

## Comparison: Snapshot vs Traditional Projections

### Snapshot Projections (Recommended)

```typescript
// ✅ Reuse evolve function
const registry = createSnapshotProjectionRegistry(
  ["CartCreated", "ItemAdded"],
  {
    evolve: domainEvolve,  // Same as write model!
    mapToColumns: (state) => ({
      currency: state.currency,  // Optional denormalization
    }),
  }
);
```

**Benefits:**

- ✅ Less code
- ✅ Consistency guaranteed
- ✅ No schema migrations
- ✅ Full state always available

### Traditional Projections (Alternative)

```typescript
// ❌ Manual field mapping for each event
const registry = {
  CartCreated: [async ({ db }, event) => {
    await db.insertInto("carts").values({
      cart_id: event.data.cartId,
      currency: event.data.currency,
      items: JSON.stringify([]),
      total: 0,
      // ... manually map all fields
    }).execute();
  }],
  ItemAdded: [async ({ db }, event) => {
    // Load cart
    const cart = await db.selectFrom("carts")...;
    
    // Manually update fields
    const items = JSON.parse(cart.items);
    items.push(event.data.item);
    
    await db.updateTable("carts")
      .set({ items: JSON.stringify(items) })
      .execute();
  }],
};
```

**Trade-offs:**

- ❌ More code to maintain
- ❌ Logic duplicated from write model
- ❌ Schema migrations for new fields
- ✅ All fields as columns (no JSONB queries)

---

## Summary

**Three Components:**

1. **Snapshot Projection** (What to do)
   - Defines event → state transformation
   - Reuses write model `evolve`
   - Stores complete state + optional denormalized columns

2. **Projection Runner** (How to do it - Tests)
   - Executes projections on-demand
   - Synchronous and deterministic
   - Perfect for testing

3. **Consumer** (How to do it - Production)
   - Executes projections continuously
   - Automatic checkpointing
   - Production-ready background processing

**Rule of Thumb:**

- 📝 **Define once:** Snapshot projection with `evolve`
- 🧪 **Test:** Use projection runner
- 🚀 **Production:** Use consumer

**Example Files:**

- `cart.event-handler.ts` - Write model (decide, evolve)
- `cart.read-model.ts` - Snapshot projection definition
- `cart.e2e.spec.ts` - Tests with projection runner
- `cart.consumer.spec.ts` - Tests with consumer

**Further Reading:**

- [Testing Projections](./TESTING_PROJECTIONS.md)
