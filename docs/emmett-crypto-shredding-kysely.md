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

Copy the migration file from [`database/migrations/`](https://github.com/wataruoguchi/emmett-libs/blob/main/packages/emmett-crypto-shredding-kysely/database/migrations/1761627233034_crypto_shredding.ts) to your migrations directory and run it.

### 2. Create Encryption Policies

**⚠️ Important:** Policies must be created **before** events can be encrypted. Create them during:

- **Tenant onboarding** - When a new tenant/partition is created
- **Application setup** - As a one-time bootstrap step
- **Feature enablement** - When enabling crypto shredding for existing streams

```typescript
import { createPolicies } from '@wataruoguchi/emmett-crypto-shredding-kysely';

// Example: During tenant onboarding
async function onboardTenant(tenantId: string) {
  // Create tenant...
  
  // Set up encryption policies for sensitive streams
  await createPolicies(db, [
    {
      policyId: `${tenantId}-generator`,
      partition: tenantId,
      streamTypeClass: 'generator', // Stream type to encrypt
      encryptionAlgorithm: 'AES-GCM',
      keyRotationIntervalDays: 180,
      keyScope: 'stream', // 'stream' or 'type'
    },
  ]);
}
```

**Alternative:** Use default policies for common use cases:

```typescript
import { createDefaultPolicies } from '@wataruoguchi/emmett-crypto-shredding-kysely';

// Creates policies for 'user-data' and 'audit-log' stream types
await createDefaultPolicies(db, 'tenant-123');
```

### 3. Create Encrypted Event Store in Your Module

Wire up the crypto event store in your module factory:

```typescript
import { 
  createCryptoEventStore,
  createWebCryptoProvider,
  type CryptoContext,
} from '@wataruoguchi/emmett-crypto-shredding';
import {
  createKeyManagement,
  createPolicyResolver,
} from '@wataruoguchi/emmett-crypto-shredding-kysely';
import { getKyselyEventStore } from '@wataruoguchi/emmett-event-store-kysely';

export function createGeneratorModule({ db, logger }) {
  const eventStore = createCryptoEventStore(
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
  
  // Use eventStore in your event handler...
  return createService({ eventStore });
}
```

**How it works:**

1. When events are appended, the policy resolver checks if the stream type has a policy
2. If a policy exists, events are encrypted using the specified algorithm
3. Keys are automatically generated and managed per the policy's `keyScope`
4. If no policy exists for a stream type, events are stored unencrypted

## API Reference

### Policy Management

#### Creating Policies

```typescript
import { 
  createPolicies, 
  createDefaultPolicies,
  type DatabasePolicyConfig 
} from '@wataruoguchi/emmett-crypto-shredding-kysely';

// Create custom policies
await createPolicies(db, [
  {
    policyId: 'tenant-123-generator',
    partition: 'tenant-123',
    streamTypeClass: 'generator',
    encryptionAlgorithm: 'AES-GCM',
    keyRotationIntervalDays: 180,
    keyScope: 'stream', // 'stream' = one key per stream, 'type' = one key per stream type
  },
]);

// Or use defaults (creates 'user-data' and 'audit-log' policies)
await createDefaultPolicies(db, 'tenant-123');
```

#### Managing Policies

```typescript
import { 
  updatePolicy, 
  listPolicies, 
  deletePolicy 
} from '@wataruoguchi/emmett-crypto-shredding-kysely';

// Update policy
await updatePolicy(db, 'tenant-123-generator', 'tenant-123', {
  encryptionAlgorithm: 'AES-GCM',
  keyRotationIntervalDays: 365,
});

// List all policies for a partition
const policies = await listPolicies(db, 'tenant-123');

// Delete policy (stops encrypting new events for this stream type)
await deletePolicy(db, 'tenant-123-generator', 'tenant-123');
```

### Key Management

The `createKeyManagement` function returns a service that automatically manages encryption keys based on your policies:

```typescript
import { createKeyManagement } from '@wataruoguchi/emmett-crypto-shredding-kysely';

const keyManagement = createKeyManagement(db);

// Get or create active key (usually done automatically by crypto event store)
const key = await keyManagement.getActiveKey({
  partition: 'tenant-123',
  keyRef: 'generator-stream-123', // Varies based on keyScope
});

// Manually rotate key for a specific reference
await keyManagement.rotateKey({
  partition: 'tenant-123',
  keyRef: 'generator-stream-123',
});

// Crypto shredding: Destroy all keys for a partition
// This makes all encrypted events for this partition unrecoverable
await keyManagement.destroyPartitionKeys({
  partition: 'tenant-123',
});
```

## Common Patterns

### Tenant Onboarding with Encryption

```typescript
async function createTenantWithEncryption(tenantData: { name: string }) {
  // 1. Create tenant
  const tenant = await tenantRepository.create(tenantData);
  
  // 2. Set up encryption policies for sensitive streams
  await createPolicies(db, [
    {
      policyId: `${tenant.id}-user-data`,
      partition: tenant.id,
      streamTypeClass: 'user-data',
      encryptionAlgorithm: 'AES-GCM',
      keyRotationIntervalDays: 180,
      keyScope: 'stream',
    },
  ]);
  
  return tenant;
}
```

### Selective Encryption by Stream Type

Only encrypt sensitive stream types. Other streams remain unencrypted for performance:

```typescript
// Encrypt sensitive streams
await createPolicies(db, [
  {
    policyId: `${tenantId}-user-data`,
    partition: tenantId,
    streamTypeClass: 'user-data', // ✅ Encrypted
    encryptionAlgorithm: 'AES-GCM',
    keyRotationIntervalDays: 180,
    keyScope: 'stream',
  },
]);

// No policy for 'cart' stream type → stored unencrypted ✓
```

### Crypto Shredding (Right to be Forgotten)

```typescript
async function forgetTenant(tenantId: string) {
  // Destroy all encryption keys for the tenant
  // This makes all encrypted events permanently unrecoverable
  await keyManagement.destroyPartitionKeys({ partition: tenantId });
  
  // Optionally: Delete unencrypted data or anonymize tenant records
  // ...
}
```

## Troubleshooting

### Events Not Being Encrypted

**Problem:** Events are stored in plaintext even though policies exist.

**Checklist:**

1. ✅ Verify policy exists: `await listPolicies(db, tenantId)`
2. ✅ Check `streamTypeClass` matches your stream type exactly
3. ✅ Ensure policy was created before appending events
4. ✅ Verify `createCryptoEventStore` is being used (not just base event store)

### Cannot Read Encrypted Events

**Problem:** Events cannot be decrypted or appear as `[encrypted]`.

**Possible causes:**

- Keys have been destroyed (crypto shredding)
- Wrong partition/tenant context
- Database connectivity issues with `encryption_keys` table

## See Also

- [Crypto Shredding Core](./emmett-crypto-shredding) - Core encryption functionality
- [Event Store Kysely](./emmett-event-store-kysely) - Base event store implementation
- [Example Application](https://github.com/wataruoguchi/emmett-libs/tree/main/example) - Complete working example with crypto shredding
