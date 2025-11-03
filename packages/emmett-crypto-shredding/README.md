# @wataruoguchi/emmett-crypto-shredding

A crypto shredding implementation for [Emmett](https://github.com/event-driven-io/emmett), enabling selective encryption of event streams for GDPR compliance and data protection.

## 📚 Documentation

**👉 [View Complete Documentation →](https://wataruoguchi.github.io/emmett-libs/emmett-crypto-shredding)**

## What This Package Does

This package provides **crypto shredding capabilities** for Emmett event stores:

- **Selective Encryption** - Encrypt only sensitive streams based on policies
- **Key Management** - Automatic key generation, rotation, and lifecycle management
- **Crypto Shredding** - Destroy encryption keys to make data permanently unrecoverable (GDPR compliance)
- **Multiple Algorithms** - Support for AES-GCM, AES-CBC, and AES-CTR with runtime detection
- **Policy-Based** - Define encryption policies by stream type and partition
- **Database Agnostic** - Works with any database through storage adapters

## Installation

```bash
npm install @wataruoguchi/emmett-crypto-shredding @event-driven-io/emmett
```

## Quick Start

### 1. Set Up Database Tables

Create the encryption keys and policies tables in your database. See the [complete documentation](https://wataruoguchi.github.io/emmett-libs/emmett-crypto-shredding#step-1-set-up-database-tables) for the SQL schema.

### 2. Create a Crypto Event Store in Your Module

The crypto event store wraps your existing event store. Create it at the module level and use it with `DeciderCommandHandler`:

**Without Crypto (e.g., Cart Module):**

```typescript
// example/src/modules/cart/cart.module.ts
import { getKyselyEventStore } from "@wataruoguchi/emmett-event-store-kysely";

export function createCartModule({ db, logger }: Dependencies) {
  const eventStore = getKyselyEventStore({ db, logger });
  const eventHandler = cartEventHandler({ eventStore, getContext });
  // ... rest of module setup
}
```

**With Crypto (e.g., Generator Module):**

```typescript
// example/src/modules/generator/generator.module.ts
import { getKyselyEventStore } from "@wataruoguchi/emmett-event-store-kysely";
import { createCryptoEventStore, createWebCryptoProvider, type CryptoContext } from "@wataruoguchi/emmett-crypto-shredding";
import { createPolicyResolver, createKeyManagement } from "@wataruoguchi/emmett-crypto-shredding-kysely";

export function createGeneratorModule({ db, logger }: Dependencies) {
  // Wrap the base event store with crypto
  const eventStore = createCryptoEventStore(
    getKyselyEventStore({ db, logger }),  // Base store
    {
      policy: createPolicyResolver(db, logger),
      keys: createKeyManagement(db),
      crypto: createWebCryptoProvider(),
      buildAAD: ({ partition, streamId }: CryptoContext) =>
        new TextEncoder().encode(`${partition}:${streamId}`),
      logger,
    },
  );
  const eventHandler = generatorEventHandler({ eventStore, getContext });
  // ... rest of module setup (identical to cart module)
}
```

**That's it!** The crypto event store is a drop-in replacement. Your event handlers, command handlers, and all other code remain exactly the same. Encryption/decryption happens transparently based on policies—no changes needed to your domain logic.

### 3. Define Encryption Policies

Set up which streams should be encrypted:

```typescript
import { createPolicies } from "@wataruoguchi/emmett-crypto-shredding-kysely";

await createPolicies(db, [
  {
    policyId: "tenant-123-generator",
    partition: "tenant-123",
    streamTypeClass: "generator",
    encryptionAlgorithm: "AES-GCM",
    keyRotationIntervalDays: 180,
    keyScope: "stream",
  },
]);
```

### 4. Crypto Shredding (GDPR Compliance)

Destroy encryption keys to make data permanently unrecoverable:

```typescript
// Destroy all keys for a partition - makes data permanently unrecoverable
await keyManagement.destroyPartitionKeys("tenant-123");
```

## See Also

- [Complete Documentation](https://wataruoguchi.github.io/emmett-libs/emmett-crypto-shredding)
- [Kysely Adapters](./packages/emmett-crypto-shredding-kysely) - PostgreSQL implementation
- [Example Application](https://github.com/wataruoguchi/emmett-libs/tree/main/example)

## Requirements

- Node.js 20+ (for Web Crypto API support)
- TypeScript 5.8+
- Emmett 0.38+

## License

MIT
