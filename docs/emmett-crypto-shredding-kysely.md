---
outline: deep
---

# @wataruoguchi/emmett-crypto-shredding-kysely

Kysely adapters for [Emmett Crypto Shredding](./emmett-crypto-shredding), providing PostgreSQL-backed implementations for key storage and policy resolution.

## Installation

```bash
npm install @wataruoguchi/emmett-crypto-shredding-kysely @wataruoguchi/emmett-crypto-shredding kysely pg
```

## Quick Start

### 1. Run Database Migration

Copy the migration file from `database/migrations/` to your migrations directory.

### 2. Create Key Management and Policy Resolver

```typescript
import { 
  createKeyManagement, 
  createPolicyResolver 
} from '@wataruoguchi/emmett-crypto-shredding-kysely';

const keyManagement = createKeyManagement(db);
const policyResolver = createPolicyResolver(db, logger);
```

### 3. Set Up Encryption Policies

```typescript
import { createDefaultPolicies, createPolicies } from '@wataruoguchi/emmett-crypto-shredding-kysely';

// Option 1: Use default policies
// Creates policies for common stream types:
// - user-data: AES-GCM, 180 day rotation, stream scope
// - audit-log: AES-GCM, 365 day rotation, stream scope
await createDefaultPolicies(db, 'tenant-123');

// Option 2: Create custom policies
await createPolicies(db, [
  {
    policyId: 'tenant-123-user-data',
    partition: 'tenant-123',
    streamTypeClass: 'user-data',
    encryptionAlgorithm: 'AES-GCM',
    keyRotationIntervalDays: 180,
    keyScope: 'stream',
  },
]);
```

### 4. Create Encrypted Event Store

```typescript
import { createCryptoEventStore } from '@wataruoguchi/emmett-crypto-shredding';
import { getKyselyEventStore } from '@wataruoguchi/emmett-event-store-kysely';

const baseEventStore = getKyselyEventStore({ db, logger });

const cryptoEventStore = createCryptoEventStore({
  baseEventStore,
  keyManagement,
  policyResolver,
  buildAAD: (ctx) => JSON.stringify({
    partition: ctx.partition,
    streamId: ctx.streamId,
    streamType: ctx.streamType,
    eventType: ctx.eventType,
  }),
  logger,
});
```

## API Reference

### Key Management

```typescript
// Get or create active key
const key = await keyManagement.getActiveKey({
  partition: 'tenant-123',
  keyRef: 'user-data',
});

// Rotate key
await keyManagement.rotateKey({
  partition: 'tenant-123',
  keyRef: 'user-data',
});

// Destroy all keys for a partition (crypto shredding)
await keyManagement.destroyPartitionKeys({
  partition: 'tenant-123',
});
```

### Policy Management

```typescript
// Create policies
await createPolicies(db, policies);

// Update policy
await updatePolicy(db, policyId, partition, {
  encryptionAlgorithm: 'AES-GCM',
  keyRotationIntervalDays: 365,
});

// List policies
const policies = await listPolicies(db, partition);

// Delete policy
await deletePolicy(db, policyId, partition);
```

## See Also

- [Crypto Shredding Core](./emmett-crypto-shredding) - Core encryption functionality
- [Event Store Kysely](./emmett-event-store-kysely) - Base event store implementation
- [Example Application](https://github.com/wataruoguchi/emmett-libs/tree/main/example) - Complete working example
