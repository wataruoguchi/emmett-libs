# Example Application Documentation

This directory contains documentation and examples for using the `@wataruoguchi/emmett-event-store-kysely` package in a real application.

## Quick Links

- 🔧 [Projections Architecture](./PROJECTIONS_ARCHITECTURE.md) - How projections work in this app
- 🧪 [Testing Projections](./TESTING_PROJECTIONS.md) - Testing strategies
- 🔄 [Consumer Usage](./consumer-usage.ts.example) - Background processing examples

## Overview

This example application demonstrates:

1. **Event-Sourced Domain Models** (Cart & Generator modules)
2. **Snapshot Projections** (Recommended read model approach)
3. **Multi-Tenancy** (Partition-based isolation)
4. **Testing Strategies** (Projection Runner for tests, Consumer for production)

## Key Concepts

### 1. Event Store

The core event store provides:

- `appendToStream()` - Write events
- `readStream()` - Read events from a stream
- `aggregateStream()` - Rebuild aggregate state

```typescript
import { getKyselyEventStore } from "@wataruoguchi/emmett-event-store-kysely";

const eventStore = getKyselyEventStore({ db, logger });

await eventStore.appendToStream(
  "cart-123",
  [{ type: "CartCreated", data: {...} }],
  { partition: "tenant-456", streamType: "cart" }
);
```

### 2. Snapshot Projections (Recommended) ⭐

Build read models by storing complete aggregate state in a JSONB column:

```typescript
import { 
  createSnapshotProjectionRegistry 
} from "@wataruoguchi/emmett-event-store-kysely/projections";

// Reuse your write model's evolve function!
const registry = createSnapshotProjectionRegistry(
  ["CartCreated", "ItemAdded", "CartCheckedOut"],
  {
    tableName: "carts",
    extractKeys: (event, partition) => ({...}),
    evolve: domainEvolve,  // Same logic as write model
    initialState,
    mapToColumns: (state) => ({...}), // Optional denormalization
  }
);
```

**Why snapshots?**

- ✅ Consistency with write model (same `evolve`)
- ✅ No schema migrations for new fields
- ✅ Less code maintenance
- ✅ Full state always available

### 3. Testing vs Production

**In Tests (Synchronous):**

```typescript
import { 
  createProjectionRunner 
} from "@wataruoguchi/emmett-event-store-kysely/projections";

const runner = createProjectionRunner({ db, readStream, registry });
await runner.projectEvents("subscription-id", "cart-123", { partition });
```

**In Production (Continuous):**

```typescript
import { createKyselyEventStoreConsumer } from "@wataruoguchi/emmett-event-store-kysely";

const consumer = createKyselyEventStoreConsumer({
  db, logger, consumerName: "carts-read-model",
});

// Subscribe to projection handlers
for (const [eventType, handlers] of Object.entries(registry)) {
  consumer.subscribe(async (event) => {
    await handler({ db, partition }, event);
  }, eventType);
}

await consumer.start();
```

## Key Files

### Domain Modules

Each module follows event sourcing patterns:

**Write Model** (`cart.event-handler.ts`):

```typescript
// Business logic
export function createDecide() {
  return (command: Command, state: State): Event => {
    // Decision logic here
  };
}

// State transitions
export function createEvolve() {
  return (state: State, event: Event): State => {
    // Apply event to state
  };
}
```

**Read Model** (`cart.read-model.ts`):
```typescript
// Snapshot projection (reuses evolve!)
export function cartsSnapshotProjection() {
  return createSnapshotProjectionRegistry(
    ["CartCreated", "ItemAdded", ...],
    {
      evolve: domainEvolve,  // Same function!
      // ... configuration
    }
  );
}

// Consumer for production
export function createCartsConsumer({ db, logger, partition }) {
  const consumer = createKyselyEventStoreConsumer({...});
  const registry = cartsSnapshotProjection();
  
  // Subscribe to all events
  for (const [eventType, handlers] of Object.entries(registry)) {
    consumer.subscribe(async (event) => {
      await handler({ db, partition }, event);
    }, eventType);
  }
  
  return consumer;
}
```

### Test Files

**E2E Tests** (`cart.e2e.spec.ts`):
- Use **Projection Runner** for fast, synchronous tests
- Explicit `await project()` calls
- Deterministic and easy to debug

**Consumer Tests** (`cart.consumer.spec.ts`):
- Use **Consumer** to test production behavior
- Requires wait helpers for async processing
- Validates real-world scenarios

### Worker Process

**Projection Worker** (`workers/projection-worker.ts`):
- Runs consumers in background
- One consumer per tenant/partition
- Graceful shutdown handling

## Running the Application

### Development

```bash
# Install dependencies
npm install

# Run migrations
npm run migrate:latest

# Start development server
npm run dev

# Run tests
npm test
```

### Production

```bash
# Build
npm run build

# Run migrations
npm run migrate:latest

# Start projection workers
node dist/workers/projection-worker.js

# Start API server
node dist/index.js
```

## Further Reading

### Example Documentation

- [Consumer Usage](./consumer-usage.ts.example) - Production examples

### External Resources

- [Emmett Documentation](https://event-driven-io.github.io/emmett/)
- [Event Sourcing Patterns](https://event-driven.io/)

## Tips

1. **Use Snapshot Projections** - Simpler than traditional field-by-field projections
2. **Test with Projection Runner** - Fast and deterministic
3. **Run Consumer in Production** - Automatic background processing
4. **One Consumer per Tenant** - Isolation and independent progress
5. **Monitor Projection Lag** - Check `subscriptions` table regularly

## Support

- **Issues**: [GitHub Issues](https://github.com/wataruoguchi/emmett-event-store-kysely/issues)
