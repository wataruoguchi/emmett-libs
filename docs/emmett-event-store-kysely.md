---
outline: deep
---

# @wataruoguchi/emmett-event-store-kysely

A Kysely-based event store implementation for [Emmett](https://github.com/event-driven-io/emmett), providing event sourcing capabilities with PostgreSQL.

## Overview

`@wataruoguchi/emmett-event-store-kysely` is a production-ready event store implementation that enables you to build event-sourced applications with PostgreSQL and TypeScript. It provides full compatibility with the Emmett framework while adding powerful features like snapshot projections, event consumers, and multi-tenancy support.

### Key Features

- **Full Event Sourcing** - Complete implementation of Emmett's event store interface
- **Snapshot Projections** - This package's recommended approach for building read models that reuse your write model logic
- **Event Consumers** - Continuous background event processing with checkpoint tracking
- **Multi-Tenancy** - Built-in partition support for tenant isolation
- **Type Safety** - Full TypeScript support with discriminated unions and type inference
- **PostgreSQL Optimized** - Efficient queries and indexing for high-performance event storage

### Architecture

The package provides:

- **Event Store** - Core event sourcing functionality (`getKyselyEventStore`)
- **Snapshot Projections** - Reuse your domain's `evolve` function for read models
- **Projection Runner** - On-demand projection execution (useful for testing and production workflows)
- **Event Consumer** - Asynchronous background processing for production

## Getting Started

### Installation

```bash
npm install @wataruoguchi/emmett-event-store-kysely @event-driven-io/emmett kysely pg
```

### Database Setup

First, set up the required PostgreSQL tables. The event store requires three tables:

- `messages` - Stores individual events
- `streams` - Tracks stream metadata and positions
- `subscriptions` - Manages consumer checkpoints

See the [migration example](https://github.com/wataruoguchi/emmett-libs/blob/main/packages/emmett-event-store-kysely/database/migrations/1758758113676_event_sourcing_migration_example.ts) for the complete schema.

**Legacy approach:** A read model table should have these columns:

- `stream_id` (TEXT/VARCHAR)
- `last_stream_position` (BIGINT)
- `last_global_position` (BIGINT)
- `partition` (TEXT)
- `snapshot` (JSONB) - Your aggregate state

**New approach (recommended):** Use `createSnapshotProjectionWithSnapshotTable` to store snapshots in a separate centralized `snapshots` table, keeping read model tables clean with only keys and denormalized columns.

### Create Event Store

```typescript
import { getKyselyEventStore } from "@wataruoguchi/emmett-event-store-kysely";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";

const db = new Kysely({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: process.env.DATABASE_URL }),
  }),
});

const eventStore = getKyselyEventStore({ 
  db, 
  logger: console,
});
```

### Write Events with Command Handlers

You typically use Emmett's `DeciderCommandHandler` to create an event handler that wraps the event store and provides domain-specific methods:

```typescript
import { DeciderCommandHandler } from "@event-driven-io/emmett";
import type { KyselyEventStore } from "@wataruoguchi/emmett-event-store-kysely";

// Define your domain logic
function createDecide() {
  return (command: CreateCart, state: CartState): CartCreated => {
    // Business logic validation
    if (state.status !== "init") {
      throw new Error("Cart already exists");
    }
    // Return event(s)
    return {
      type: "CartCreated",
      data: {
        eventData: { currency: command.data.currency },
        eventMeta: {
          tenantId: command.data.tenantId,
          cartId: command.data.cartId,
          createdBy: "user-123",
          version: 1,
        },
      },
    };
  };
}

function createEvolve() {
  return (state: CartState, event: CartEvent): CartState => {
    switch (event.type) {
      case "CartCreated":
        return {
          status: "active",
          tenantId: event.data.eventMeta.tenantId,
          cartId: event.data.eventMeta.cartId,
          currency: event.data.eventData.currency,
          items: [],
        };
      // ... other event handlers
    }
  };
}

// Create an event handler for your domain
export function cartEventHandler({
  eventStore,
}: {
  eventStore: KyselyEventStore;
}) {
  const handler = DeciderCommandHandler({
    decide: createDecide(),
    evolve: createEvolve(),
    initialState: () => ({ status: "init", items: [] }),
  });

  return {
    create: (cartId: string, data: { tenantId: string; currency: string }) =>
      handler(
        eventStore,
        cartId,
        { type: "CreateCart", data },
        { partition: data.tenantId, streamType: "cart" },
      ),
    // ... other domain methods
  };
}

// Usage
const eventStore = getKyselyEventStore({ db, logger });
const cartHandler = cartEventHandler({ eventStore });

await cartHandler.create("cart-123", {
  tenantId: "tenant-456",
  currency: "USD",
});
```

### Reading from Read Models

For reading data, you query your read models (projections) through repositories, not directly from the event store:

```typescript
// Read from the projected read model table
const cart = await db
  .selectFrom("carts")
  .selectAll()
  .where("cart_id", "=", "cart-123")
  .where("tenant_id", "=", "tenant-456")
  .executeTakeFirst();

// Access full state from snapshot
const state = cart.snapshot as CartState;
```

### Build Read Models with Snapshot Projections

This package recommends using snapshot projections, which reuse your domain's `evolve` function to ensure consistency between write and read models. There are two approaches:

#### Option A: Separate Snapshot Table (Recommended) ⭐

Use `createSnapshotProjectionRegistryWithSnapshotTable` to store snapshots in a centralized table:

```typescript
import { 
  createSnapshotProjectionRegistryWithSnapshotTable 
} from "@wataruoguchi/emmett-event-store-kysely";

// First, create the snapshots table:
// CREATE TABLE snapshots (
//   readmodel_table_name TEXT NOT NULL,
//   stream_id TEXT NOT NULL,
//   last_stream_position BIGINT NOT NULL,
//   last_global_position BIGINT NOT NULL,
//   snapshot JSONB NOT NULL,
//   PRIMARY KEY (readmodel_table_name, stream_id)
// );

// Reuse your write model's evolve function!
const registry = createSnapshotProjectionRegistryWithSnapshotTable(
  ["CartCreated", "ItemAdded", "CartCheckedOut"],
  {
    tableName: "carts",
    extractKeys: (event, partition) => ({
      tenant_id: event.data.eventMeta.tenantId,
      cart_id: event.data.eventMeta.cartId,
      partition,
    }),
    evolve: domainEvolve,      // Same function as write model!
    initialState: () => ({ status: "init", items: [] }),
    mapToColumns: (state) => ({ // Optional: denormalize for queries
      currency: state.status !== "init" ? state.currency : null,
      total: state.status === "checkedOut" ? state.total : null,
    }),
  }
);
```

**Benefits:**

- ✅ Cleaner read model tables (no event-sourcing columns needed)
- ✅ Easier to create new read models (no schema migrations for event-sourcing columns)
- ✅ Centralized snapshot management

**Read model table schema:**

```sql
CREATE TABLE carts (
  tenant_id VARCHAR(100) NOT NULL,
  cart_id VARCHAR(100) NOT NULL,
  partition VARCHAR(100) NOT NULL,
  
  -- Optional: Denormalized columns from mapToColumns
  currency VARCHAR(3),
  total NUMERIC(10, 2),
  
  PRIMARY KEY (tenant_id, cart_id, partition)
);
```

#### Option B: Legacy Approach (Backward Compatible)

Use `createSnapshotProjectionRegistry` to store everything in the read model table:

```typescript
import { 
  createSnapshotProjectionRegistry 
} from "@wataruoguchi/emmett-event-store-kysely";

// Reuse your write model's evolve function!
const registry = createSnapshotProjectionRegistry(
  ["CartCreated", "ItemAdded", "CartCheckedOut"],
  {
    tableName: "carts",
    extractKeys: (event, partition) => ({
      tenant_id: event.data.eventMeta.tenantId,
      cart_id: event.data.eventMeta.cartId,
      partition,
    }),
    evolve: domainEvolve,      // Same function as write model!
    initialState: () => ({ status: "init", items: [] }),
    mapToColumns: (state) => ({ // Optional: denormalize for queries
      currency: state.status !== "init" ? state.currency : null,
      total: state.status === "checkedOut" ? state.total : null,
    }),
  }
);
```

**Read model table schema:**

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
  
  -- Optional: Denormalized columns from mapToColumns
  currency VARCHAR(3),
  total NUMERIC(10, 2),
  
  PRIMARY KEY (tenant_id, cart_id, partition)
);
```

**Arguments (both approaches):**

- **First argument**: Array of event types to handle
- **Second argument**: Configuration object
  - `tableName`: Database table name for the projection
  - `extractKeys`: Function that returns primary key values from the event (keys are inferred automatically)
  - `evolve`: Your domain's evolve function (reuse from write model)
  - `initialState`: Function that returns the initial aggregate state
  - `mapToColumns` _(optional)_: Function to denormalize state fields into table columns for querying

### Process Events (On-Demand)

For on-demand processing (tests, backfills, or scheduled jobs), use the projection runner:

```typescript
import { createProjectionRunner } from "@wataruoguchi/emmett-event-store-kysely";

const runner = createProjectionRunner({ 
  db, 
  readStream: eventStore.readStream, 
  registry,
});

await runner.projectEvents("subscription-id", "cart-123", {
  partition: "tenant-456"
});
```

**Note:** The projection runner executes asynchronously when called (not blocking), processing events immediately on-demand. This makes it suitable for:

- **Tests** - Fast, deterministic execution
- **Production Workers** - Scheduled jobs or background workers (see example worker below)
- **Backfills** - Reprocessing historical events
- **Manual Triggers** - On-demand reprocessing

### Production Worker Example

The projection runner can be used in production workers for scheduled or continuous processing:

```typescript
// In a worker process
const runner = createProjectionRunner({ db, readStream, registry });

// Process all streams in a partition
while (true) {
  const streams = await db
    .selectFrom("streams")
    .select(["stream_id"])
    .where("partition", "=", partition)
    .limit(50)
    .execute();
  
  for (const stream of streams) {
    await runner.projectEvents("worker-subscription", stream.stream_id, {
      partition,
      batchSize: 200,
    });
  }
  
  await new Promise((resolve) => setTimeout(resolve, 1000)); // Poll interval
}
```

### Process Events (Continuous Background Processing)

For continuous, automatic background processing, use the event consumer:

```typescript
import { createKyselyEventStoreConsumer } from "@wataruoguchi/emmett-event-store-kysely";

const consumer = createKyselyEventStoreConsumer({
  db,
  logger,
  consumerName: "carts-read-model",
  batchSize: 100,
  pollingInterval: 1000, // Poll every 1 second
});

// Subscribe to events
consumer.subscribe(async (event) => {
  // Process event
  await processEvent({ db, partition: event.metadata.partition }, event);
}, "CartCreated");

await consumer.start();
```

## API Reference

### Event Store

#### `getKyselyEventStore(deps: Dependencies): KyselyEventStore`

Creates a new event store instance.

**Parameters:**

```typescript
interface Dependencies {
  db: DatabaseExecutor;  // Kysely database instance
  logger?: Logger;       // Optional logger
  inTransaction?: boolean;
}
```

**Returns:** `KyselyEventStore` - Event store instance

**Example:**

```typescript
const eventStore = getKyselyEventStore({ db, logger });
```

#### Event Store Methods

The event store implements Emmett's `EventStore` interface. Typically, you don't call these methods directly—instead, you use `DeciderCommandHandler` from Emmett which internally uses these methods:

- **`appendToStream()`** - Appends events to a stream (used internally by DeciderCommandHandler)

- **`readStream()`** - Reads events from a stream (used internally for state reconstruction)

- **`aggregateStream()`** - Rebuilds aggregate state from events (used internally by DeciderCommandHandler)

For most use cases, you'll work with command handlers rather than calling these methods directly. However, they're available if you need lower-level control.

#### `aggregateStream(streamName: string, options): Promise<AggregateStreamResult>`

Rebuilds aggregate state from events. This is typically used internally by `DeciderCommandHandler`.

```typescript
const result = await eventStore.aggregateStream("cart-123", {
  partition: "tenant-456",
  evolve: (state, event) => { /* ... */ },
  getInitialState: () => ({ status: "init" }),
});
```

### Snapshot Projections

#### `createSnapshotProjectionRegistryWithSnapshotTable(eventTypes, config)` ⭐ Recommended

Creates a projection registry for snapshot-based read models using a separate centralized snapshots table.

```typescript
const registry = createSnapshotProjectionRegistryWithSnapshotTable(
  ["CartCreated", "ItemAdded"],
  {
    tableName: "carts",
    extractKeys: (event, partition) => ({ /* ... */ }),
    evolve: domainEvolve,
    initialState: () => ({ /* ... */ }),
    mapToColumns: (state) => ({ /* ... */ }), // Optional
  }
);
```

**Benefits:**

- Cleaner read model tables (no event-sourcing columns)
- Easier to create new read models
- Centralized snapshot management
- Deterministic `stream_id` construction from keys (URL-encoded for safety)

**Database schema required:**

```sql
CREATE TABLE snapshots (
  readmodel_table_name TEXT NOT NULL,
  stream_id TEXT NOT NULL,
  last_stream_position BIGINT NOT NULL,
  last_global_position BIGINT NOT NULL,
  snapshot JSONB NOT NULL,
  PRIMARY KEY (readmodel_table_name, stream_id)
);
```

**Important Notes:**

- **Primary Key Consistency**: The `extractKeys` function must return the same set of keys for all events. The projection validates this at runtime and will throw an error if keys are inconsistent.
- **Idempotency**: Events with `streamPosition <= lastProcessedPosition` are automatically skipped, ensuring idempotent processing.
- **Race Condition Protection**: Runs each projection update inside a transaction opened by the projection runner and uses `FOR UPDATE` row-level locking within that transaction to prevent concurrent conflicts.
- **Snapshot Format**: Handles both string and parsed JSON snapshot formats (different database drivers return JSONB differently).
- **Special Characters**: Keys with special characters (like `|` or `:`) are safely URL-encoded in the `stream_id` construction.

#### `createSnapshotProjectionRegistry(eventTypes, config)` (Legacy)

Creates a projection registry for snapshot-based read models (legacy approach - stores everything in the read model table).

```typescript
const registry = createSnapshotProjectionRegistry(
  ["CartCreated", "ItemAdded"],
  {
    tableName: "carts",
    extractKeys: (event, partition) => ({ /* ... */ }),
    evolve: domainEvolve,
    initialState: () => ({ /* ... */ }),
    mapToColumns: (state) => ({ /* ... */ }), // Optional
  }
);
```

**Important Notes:**

- **Primary Key Consistency**: The `extractKeys` function must return the same set of keys for all events. The projection validates this at runtime and will throw an error if keys are inconsistent.
- **Idempotency**: Events with `streamPosition <= lastProcessedPosition` are automatically skipped, ensuring idempotent processing.
- **Race Condition Protection**: Uses `FOR UPDATE` row-level locking to prevent concurrent transaction conflicts.
- **Snapshot Format**: Handles both string and parsed JSON snapshot formats (different database drivers return JSONB differently).
- **Transaction Safety**: All operations run within a transaction to ensure atomicity.

### Projection Runner

#### `createProjectionRunner(deps): ProjectionRunner`

Creates a projection runner for on-demand event processing. The runner executes immediately when called and processes events in batches, making it suitable for tests, backfills, or scheduled production jobs.

```typescript
const runner = createProjectionRunner({
  db,
  readStream: eventStore.readStream,
  registry,
});

await runner.projectEvents("subscription-id", "stream-id", {
  partition: "tenant-id",
});
```

### Event Consumer

#### `createKyselyEventStoreConsumer(config): KyselyEventStoreConsumer`

Creates an event consumer that automatically polls and processes events by global position across all streams. Ideal for continuous, hands-off background processing.

```typescript
const consumer = createKyselyEventStoreConsumer({
  db,
  logger,
  consumerName: "my-consumer",
  batchSize: 100,
  pollingInterval: 1000,
});

consumer.subscribe(async (event) => {
  // Handle event
}, "EventType");

await consumer.start();
await consumer.stop(); // Graceful shutdown
```

## Useful Links

### Event Sourcing

- [Emmett Documentation](https://event-driven-io.github.io/emmett/) - Official Emmett framework documentation
- [Event-Driven Architecture](https://event-driven.io/) - Event sourcing patterns and best practices
- [Event Sourcing Explained](https://martinfowler.com/eaaDev/EventSourcing.html) - Martin Fowler's explanation of event sourcing

### Read Models & Projections

- [CQRS Pattern](https://martinfowler.com/bliki/CQRS.html) - Command Query Responsibility Segregation
- [Guide to Projections and Read Models in Event-Driven Architecture](https://event-driven.io/en/projections_and_read_models_in_event_driven_architecture/) - Understanding projections
- [Snapshot Projections Guide](https://github.com/wataruoguchi/emmett-libs/blob/main/example/src/docs/PROJECTIONS_ARCHITECTURE.md) - Detailed guide to snapshot projections

### PostgreSQL & Kysely

- [Kysely Documentation](https://kysely.dev/) - Type-safe SQL query builder
- [PostgreSQL Documentation](https://www.postgresql.org/docs/) - Official PostgreSQL docs
- [PostgreSQL Partitioning](https://www.postgresql.org/docs/current/ddl-partitioning.html) - Multi-tenancy with partitioning

### TypeScript

- [Discriminated Unions](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions) - Type-safe event patterns

### Testing

- [Vitest Documentation](https://vitest.dev/) - Fast unit test framework
- [Testing Projections Guide](https://github.com/wataruoguchi/emmett-libs/blob/main/example/src/docs/TESTING_PROJECTIONS.md) - Best practices for testing projections
