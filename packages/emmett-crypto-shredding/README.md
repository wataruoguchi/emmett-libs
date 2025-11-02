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

### 1. Create a Crypto Event Store

```typescript
import { createCryptoEventStore, createWebCryptoProvider } from "@wataruoguchi/emmett-crypto-shredding";
import { createPolicyResolver, createKeyManagement } from "@wataruoguchi/emmett-crypto-shredding-kysely";

const cryptoStore = createCryptoEventStore(baseStore, {
  policy: createPolicyResolver(db, logger),
  keys: createKeyManagement(db),
  crypto: createWebCryptoProvider(),
  buildAAD: (ctx) => {
    return JSON.stringify({
      partition: ctx.partition,
      streamId: ctx.streamId,
      streamType: ctx.streamType,
      eventType: ctx.eventType,
    });
  },
  logger,
});
```

### 2. Use the Crypto Event Store

The crypto event store has the same interface as the base event store, but automatically encrypts/decrypts events based on policies:

```typescript
// Write events - automatically encrypted if policy requires it
await cryptoStore.appendToStream("user-123", [userCreatedEvent], {
  partition: "tenant-123",
  streamType: "user-data",
});

// Read events - automatically decrypted
const result = await cryptoStore.readStream("user-123", {
  partition: "tenant-123",
});
```

### 3. Crypto Shredding (GDPR Compliance)

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
