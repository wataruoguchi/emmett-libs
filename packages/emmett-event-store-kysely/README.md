# @wataruoguchi/emmett-event-store-kysely

A Kysely-based event store implementation for [Emmett](https://github.com/event-driven-io/emmett), providing event sourcing capabilities with PostgreSQL.

## 📚 Documentation

**👉 [View Complete Documentation →](https://wataruoguchi.github.io/emmett-libs/emmett-event-store-kysely)**

## Features

- **Event Store** - Full event sourcing with Kysely and PostgreSQL
- **Snapshot Projections** - Recommended approach for read models
- **Event Consumer** - Continuous background event processing
- **Type Safety** - Full TypeScript support with discriminated unions
- **Multi-Tenancy** - Built-in partition support

## Installation

```bash
npm install @wataruoguchi/emmett-event-store-kysely @event-driven-io/emmett kysely pg
```

## Quick Start

### 1. Database Setup

Set up the required PostgreSQL tables using [our migration example](https://github.com/wataruoguchi/emmett-libs/blob/main/packages/emmett-event-store-kysely/database/migrations/1758758113676_event_sourcing_migration_example.ts):

```typescript
import { Kysely } from "kysely";

// Required tables: messages, streams, subscriptions
```

**Legacy approach:** A read model table expects to have the following columns:

- stream_id (uuid)
- last_stream_position (bigint)
- last_global_position (bigint)
- partition (text)
- snapshot (jsonb)

**New approach (recommended):** Use `createSnapshotProjectionWithSnapshotTable` to store snapshots in a separate centralized table, keeping read model tables clean with only keys and denormalized columns.

### 2. Create Event Store

```typescript
import { getKyselyEventStore } from "@wataruoguchi/emmett-event-store-kysely";
import { Kysely, PostgresDialect } from "kysely";

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

### 3. Write Events & Commands & Business Logic & State

Please read <https://event-driven-io.github.io/emmett/getting-started.html>

- [Events](https://event-driven-io.github.io/emmett/getting-started.html#events)
- [Commands](https://event-driven-io.github.io/emmett/getting-started.html#commands)
- [Business logic and decisions](https://event-driven-io.github.io/emmett/getting-started.html#business-logic-and-decisions)
- [Building state from events](https://event-driven-io.github.io/emmett/getting-started.html#building-state-from-events)

### 4. Build Read Models

This package supports "Snapshot Projections" with two approaches:

#### Option A: Separate Snapshot Table (Recommended) ⭐

Use `createSnapshotProjectionWithSnapshotTable` to store snapshots in a centralized table:

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
    evolve: domainEvolve,      // Reuse from write model!
    initialState,
    mapToColumns: (state) => ({ // Optional: denormalize for queries
      currency: state.currency,
      total: state.status === "checkedOut" ? state.total : null,
    }),
  }
);
```

**Benefits:**

- ✅ Cleaner read model tables (no event-sourcing columns)
- ✅ Easier to create new read models (no schema migrations for event-sourcing columns)
- ✅ Centralized snapshot management
- ✅ Race condition protection with `FOR UPDATE` locking
- ✅ Operations wrapped in transactions for stronger race condition protection
- ✅ Automatic idempotency (skips already-processed events)
- ✅ Primary key validation (ensures consistent `extractKeys`)

**Important:** The `extractKeys` function must return the same set of keys for all events. The projection validates this at runtime.

#### Option B: Legacy Approach (Backward Compatible)

Use `createSnapshotProjectionRegistry` to store everything in the read model table:

**Note:** This approach stores event-sourcing columns (`stream_id`, `last_stream_position`, etc.) directly in the read model table. Consider using Option A for new projects.

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
    evolve: domainEvolve,      // Reuse from write model!
    initialState,
    mapToColumns: (state) => ({ // Optional: denormalize for queries
      currency: state.currency,
      total: state.status === "checkedOut" ? state.total : null,
    }),
  }
);
```

### 5. Process Events and Update Read Model

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

## Examples

- [Working Example](https://github.com/wataruoguchi/emmett-libs/tree/main/example/) - Complete application with carts and generators
- [Migration Example](https://github.com/wataruoguchi/emmett-libs/blob/main/packages/emmett-event-store-kysely/database/migrations/1758758113676_event_sourcing_migration_example.ts) - Database setup

## License

MIT

## Contributing

Contributions are welcome! Please see our [GitHub repository](https://github.com/wataruoguchi/emmett-libs) for issues and PRs.
