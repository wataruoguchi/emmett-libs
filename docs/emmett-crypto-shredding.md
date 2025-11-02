---
outline: deep
---

# @wataruoguchi/emmett-crypto-shredding

A crypto shredding implementation for [Emmett](https://github.com/event-driven-io/emmett), enabling selective encryption of event streams for GDPR compliance and data protection.

## Overview

`@wataruoguchi/emmett-crypto-shredding` adds cryptographic encryption capabilities to your event store, allowing you to selectively encrypt sensitive event streams while maintaining full compatibility with the Emmett framework. The package implements crypto shredding—the practice of destroying encryption keys to make data permanently unrecoverable—which is essential for GDPR compliance and data protection regulations.

### Key Features

- **Crypto Shredding** - Destroy encryption keys to make data permanently unrecoverable (GDPR compliance)
- **Policy-Based** - Define encryption policies by stream type, partition, or tenant
- **Selective Encryption** - Encrypt only sensitive streams based on configurable policies
- **Key Management** - Automatic key generation, rotation, and lifecycle management
- **Multiple Algorithms** - Support for AES-GCM, AES-CBC, and AES-CTR with runtime detection
- **Database Agnostic** - Works with any database through storage adapters
- **Type Safe** - Full TypeScript support with comprehensive type definitions
- **Zero Breaking Changes** - Non-invasive decorator pattern that wraps existing event stores

### Use Cases

- **GDPR Compliance** - Enable "right to be forgotten" by destroying encryption keys
- **Data Protection** - Encrypt sensitive PII, financial data, or health information
- **Regulatory Compliance** - Meet requirements for SOC2, HIPAA, and other standards
- **Data Minimization** - Only encrypt what needs protection, keep performance optimal
- **Key Rotation** - Rotate keys while maintaining ability to decrypt historical events

### Architecture

The package uses a decorator pattern that wraps your existing event store:

- **Crypto Event Store** - Wraps base event store and adds encryption/decryption
- **Policy Resolver** - Determines which streams should be encrypted
- **Key Management** - Handles key generation, rotation, and destruction
- **Crypto Provider** - Provides encryption/decryption operations (Web Crypto API)

## Getting Started

### Installation

```bash
npm install @wataruoguchi/emmett-crypto-shredding @event-driven-io/emmett
```

### Prerequisites

- Node.js 20+ (for Web Crypto API support)
- TypeScript 5.8+
- Emmett 0.38+
- An existing event store (e.g., `@wataruoguchi/emmett-event-store-kysely`)

### Step 1: Set Up Database Tables

Create tables for encryption policies, keys, and key history. The tables use PostgreSQL partitioning for multi-tenancy:

```sql
-- Encryption keys table (PARTITIONED)
CREATE TABLE encryption_keys (
  key_id TEXT NOT NULL,
  partition TEXT NOT NULL,
  key_material BYTEA NOT NULL,
  key_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
  destroyed_at TIMESTAMPTZ(3),
  is_active BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (key_id, partition)
) PARTITION BY LIST (partition);

CREATE INDEX idx_encryption_keys_partition ON encryption_keys (partition);
CREATE INDEX idx_encryption_keys_active ON encryption_keys (is_active, destroyed_at);

-- Encryption policies table (PARTITIONED)
CREATE TABLE encryption_policies (
  policy_id TEXT NOT NULL,
  partition TEXT NOT NULL,
  stream_type_class TEXT NOT NULL,
  key_scope TEXT NOT NULL DEFAULT 'type',
  encryption_algorithm TEXT,
  key_rotation_interval_days INTEGER,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
  PRIMARY KEY (policy_id, partition)
) PARTITION BY LIST (partition);

CREATE INDEX idx_encryption_policies_stream_type ON encryption_policies (stream_type_class, partition);

-- Create DEFAULT partitions for each table
CREATE TABLE encryption_keys_default PARTITION OF encryption_keys DEFAULT;
CREATE TABLE encryption_policies_default PARTITION OF encryption_policies DEFAULT;
```

**Note:** The `key_id` format is `${partition}::${keyRef}@${version}`. The `key_ref` is encoded in the `key_id`, not stored as a separate column. This allows flexible key scoping (per-stream, per-type, or per-tenant).

**Key Usage Tracking:** Key usage history is tracked directly in message metadata. Each encrypted message stores `keyId` and `keyVersion` in `metadata.enc`, allowing audit queries to determine which keys were used at which stream positions without requiring a separate history table.

### Step 2: Implement Storage Adapters

You need to implement storage interfaces for policies and keys:

```typescript
import type { PolicyStorage, KeyStorage } from "@wataruoguchi/emmett-crypto-shredding";

// Policy storage adapter (using Kysely)
const policyStorage: PolicyStorage = {
  async findPolicy(params) {
    const result = await db
      .selectFrom("encryption_policies")
      .selectAll()
      .where("partition", "=", params.partition)
      .where("stream_type_class", "=", params.streamTypeClass)
      .executeTakeFirst();
    
    return result ? {
      policyId: result.policy_id,
      partition: result.partition,
      streamTypeClass: result.stream_type_class,
      encryptionAlgorithm: result.encryption_algorithm,
      keyRotationIntervalDays: result.key_rotation_interval_days,
      keyScope: result.key_scope,
    } : null;
  },
  // ... other methods
};

// Key storage adapter
// Note: key_ref is encoded in key_id as `${partition}::${keyRef}@${version}`
const keyStorage: KeyStorage = {
  async findActiveKey({ partition, keyRef }) {
    const result = await db
      .selectFrom("encryption_keys")
      .select(["key_id", "key_version", "key_material"])
      .where("partition", "=", partition)
      .where("key_id", "like", `${partition}::${keyRef}@%`)
      .where("is_active", "=", true)
      .where("destroyed_at", "is", null)
      .orderBy("key_version", "desc")
      .executeTakeFirst();
    
    return result ? {
      keyId: result.key_id,
      keyVersion: result.key_version,
      keyMaterial: new Uint8Array(result.key_material as Buffer),
    } : null;
  },
  
  async findKeyById({ partition, keyId }) {
    const result = await db
      .selectFrom("encryption_keys")
      .select(["key_id", "key_version", "key_material"])
      .where("key_id", "=", keyId)
      .where("partition", "=", partition)
      .where("destroyed_at", "is", null)
      .executeTakeFirst();
    
    return result ? {
      keyId: result.key_id,
      keyVersion: result.key_version,
      keyMaterial: new Uint8Array(result.key_material as Buffer),
    } : null;
  },
  
  async findCurrentActiveKeyVersion({ partition, keyRef }) {
    const result = await db
      .selectFrom("encryption_keys")
      .select(["key_version"])
      .where("partition", "=", partition)
      .where("key_id", "like", `${partition}::${keyRef}@%`)
      .where("is_active", "=", true)
      .where("destroyed_at", "is", null)
      .orderBy("key_version", "desc")
      .executeTakeFirst();
    
    return result?.key_version ?? null;
  },
  
  async insertKey({ keyId, partition, keyMaterial, keyVersion }) {
    await db
      .insertInto("encryption_keys")
      .values({
        key_id: keyId,
        partition: partition,
        key_material: Buffer.from(keyMaterial),
        key_version: keyVersion,
        is_active: true,
        destroyed_at: null,
      })
      .execute();
  },
  
  async deactivateKeys({ partition, keyRef }) {
    await db
      .updateTable("encryption_keys")
      .set({ is_active: false })
      .where("partition", "=", partition)
      .where("key_id", "like", `${partition}::${keyRef}@%`)
      .execute();
  },
  
  async destroyPartitionKeys({ partition }) {
    await db
      .updateTable("encryption_keys")
      .set({ destroyed_at: new Date() })
      .where("partition", "=", partition)
      .execute();
  },
};
```

### Step 3: Create Crypto Event Store

```typescript
import { createCryptoEventStore, createWebCryptoProvider, createPolicyResolver, createKeyManagement, type CryptoContext } from "@wataruoguchi/emmett-crypto-shredding";
import { getKyselyEventStore } from "@wataruoguchi/emmett-event-store-kysely";

// Create base event store
const baseStore = getKyselyEventStore({ db, logger });

// Create crypto provider (Web Crypto API)
const crypto = createWebCryptoProvider();

// Create policy resolver (from Step 2)
const policyResolver = createPolicyResolver(policyStorage);

// Create key management (from Step 2)
const keyManagement = createKeyManagement(keyStorage);

// Wrap base store with crypto
const cryptoStore = createCryptoEventStore(baseStore, {
  policy: policyResolver,
  keys: keyManagement,
  crypto: crypto,
  buildAAD: ({ partition, streamId }: CryptoContext) =>
    new TextEncoder().encode(`${partition}:${streamId}`),
  logger,
});
```

**Note:** The `buildAAD` function creates Additional Authenticated Data (AAD) for encryption, which binds the ciphertext to the specific partition and stream ID. This provides additional security by preventing ciphertext reuse across different contexts. The partition and streamType are automatically extracted from the options passed when writing events (e.g., through `DeciderCommandHandler`).

### Step 4: Define Encryption Policies

```typescript
import { getDefaultPolicies } from "@wataruoguchi/emmett-crypto-shredding";

// Get default policies for common stream types
const defaultPolicies = getDefaultPolicies("tenant-123");
// Returns policies for:
// - user-data (AES-GCM, 180 day rotation)
// - audit-log (AES-GCM, 365 day rotation)

// Insert policies into database
for (const policy of defaultPolicies) {
  await db
    .insertInto("encryption_policies")
    .values({
      policy_id: policy.policyId,
      partition: policy.partition,
      stream_type_class: policy.streamTypeClass,
      encryption_algorithm: policy.encryptionAlgorithm,
      key_rotation_interval_days: policy.keyRotationIntervalDays,
      key_scope: policy.keyScope,
    })
    .execute();
}
```

### Step 5: Use the Crypto Event Store

The crypto event store wraps your existing event store and has the same interface. The only difference in your module composition is how you create the event store.

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
import { createDatabasePolicy } from "./application/event-sourcing/crypto/policy.kysely-adapter.js";
import { createDatabaseKeys } from "./application/event-sourcing/crypto/keys.kysely-adapter.js";

export function createGeneratorModule({ db, logger }: Dependencies) {
  // Wrap the base event store with crypto
  const eventStore = createCryptoEventStore(
    getKyselyEventStore({ db, logger }),  // Base store
    {
      policy: createDatabasePolicy(db, logger),
      keys: createDatabaseKeys(db),
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

**That's it!** The crypto event store is a drop-in replacement. Your event handlers, services, and all other code remain exactly the same. Encryption/decryption happens transparently based on policies—no changes needed to your domain logic.

### Step 6: Read from Projections

Read decrypted data from your read models (projections):

```typescript
// Query the read model table (data is already decrypted by projections)
const user = await db
  .selectFrom("users")
  .selectAll()
  .where("user_id", "=", "user-123")
  .where("tenant_id", "=", "tenant-456")
  .executeTakeFirst();

// Access full state from snapshot
const state = user.snapshot as UserState;
```

### Step 7: Crypto Shredding (GDPR Compliance)

Destroy encryption keys to make data permanently unrecoverable:

```typescript
// Destroy all keys for a partition
await keyManagement.destroyPartitionKeys("tenant-123");

// Future reads of encrypted events will gracefully skip them
// (events remain in database but cannot be decrypted)
// Projections processing these events will skip them automatically
```

## API Reference

### Core Functions

#### `createCryptoEventStore(base, deps): EventStore`

Creates a crypto-enabled event store that wraps a base event store.

**Parameters:**

```typescript
interface Dependencies {
  policy: EncryptionPolicyResolver;  // Determines encryption requirements
  keys: KeyManagement;                // Manages encryption keys
  crypto: CryptoProvider;             // Performs encryption/decryption
  buildAAD?: (ctx: CryptoContext) => Uint8Array;  // Optional: additional authenticated data
  getPartition?: (options?: unknown) => string | undefined;
  getStreamType?: (options?: unknown) => string | undefined;
  logger?: Logger;
}
```

**Returns:** Event store instance with same interface as base store

**Example:**

```typescript
const cryptoStore = createCryptoEventStore(baseStore, {
  policy: policyResolver,
  keys: keyManagement,
  crypto: cryptoProvider,
});
```

#### `createWebCryptoProvider(): CryptoProvider`

Creates a crypto provider using the Web Crypto API (Node.js 20+ or browsers).

**Example:**

```typescript
const crypto = createWebCryptoProvider();
```

#### `createPolicyResolver(storage, onError?): EncryptionPolicyResolver`

Creates a policy resolver that determines encryption requirements.

```typescript
const resolver = createPolicyResolver(policyStorage, (error, ctx) => {
  logger.error("Policy resolution error", { error, ctx });
});
```

#### `createKeyManagement(storage): KeyManagement`

Creates a key management service.

```typescript
const keys = createKeyManagement(keyStorage);
```

### Policy Management

#### `getDefaultPolicies(partition: string): PolicyConfig[]`

Generates default encryption policies for common stream types.

```typescript
const policies = getDefaultPolicies("tenant-123");
// Returns:
// [
//   {
//     policyId: "tenant-123-user-data",
//     streamTypeClass: "user-data",
//     encryptionAlgorithm: "AES-GCM",
//     keyRotationIntervalDays: 180,
//     keyScope: "stream",
//     partition: "tenant-123",
//   },
//   // ... more policies
// ]
```

### Key Management

#### `getActiveKey(params): Promise<KeyInfo>`

Gets or creates the active encryption key for a partition and key reference.

```typescript
const key = await keyManagement.getActiveKey({
  partition: "tenant-123",
  keyRef: "user-data",
});
// Returns: { keyId, keyVersion, keyBytes }
```

#### `rotateKey(params): Promise<KeyInfo>`

Rotates the encryption key for a partition and key reference.

```typescript
const newKey = await keyManagement.rotateKey({
  partition: "tenant-123",
  keyRef: "user-data",
});
// Old key is deactivated, new key is created
// Historical events can still be decrypted with old keys
```

#### `destroyPartitionKeys(partition: string): Promise<void>`

Destroys all encryption keys for a partition (crypto shredding).

```typescript
await keyManagement.destroyPartitionKeys("tenant-123");
// All keys for tenant-123 are destroyed
// Encrypted events become permanently unrecoverable
```

### Algorithm Utilities

#### `detectRuntimeInfo(): Promise<RuntimeInfo>`

Detects the runtime environment and supported encryption algorithms.

```typescript
const info = await detectRuntimeInfo();
// Returns: {
//   runtime: "Node.js",
//   version: "20.0.0",
//   supportedAlgorithms: ["AES-GCM", "AES-CBC", "AES-CTR"],
// }
```

#### `validateAlgorithmSupport(algorithm): Promise<void>`

Validates that a specific algorithm is supported in the current runtime.

```typescript
await validateAlgorithmSupport("AES-GCM");
// Throws if not supported
```

#### `getAllSupportedAlgorithms(): SupportedAlgorithm[]`

Returns all supported encryption algorithms.

```typescript
const algorithms = getAllSupportedAlgorithms();
// Returns: ["AES-GCM", "AES-CBC", "AES-CTR"]
```

### Types

```typescript
type SupportedAlgorithm = 
  | "AES-GCM" 
  | "AES-CBC" 
  | "AES-CTR";

type KeyScope = "stream" | "type" | "tenant";

interface PolicyConfig {
  policyId: string;
  streamTypeClass: string;
  encryptionAlgorithm: SupportedAlgorithm;
  keyRotationIntervalDays: number;
  keyScope: KeyScope;
  partition: string;
}

interface EncryptionMetadata {
  enc: {
    algo: SupportedAlgorithm;
    keyId: string;
    keyVersion: number;
    iv: string; // Base64-encoded IV
  };
}
```

## Useful Links

### Crypto Shredding & Encryption

- [Crypto Shredding Explained](https://en.wikipedia.org/wiki/Cryptographic_erasure) - Wikipedia article on crypto shredding
- [GDPR Right to Erasure](https://gdpr.eu/right-to-be-forgotten/) - Understanding GDPR requirements
- [OWASP Cryptographic Storage](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html) - Best practices for encryption

### Node.js Cryptography

- [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API) - MDN documentation
- [Node.js Crypto Module](https://nodejs.org/api/crypto.html) - Official Node.js crypto documentation
- [Crypto in Node.js 20+](https://nodejs.org/api/globals.html#crypto) - Global crypto support

### Encryption Algorithms

- [AES-GCM Specification](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-38d.pdf) - NIST specification
- [AES-CBC Specification](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-38a.pdf) - NIST specification
- [AES-CTR Specification](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-38a.pdf) - NIST specification
- [NIST Guidelines for Cryptography](https://csrc.nist.gov/publications/detail/sp/800-175b/rev-1/final) - NIST cryptographic standards and guidelines

### Event Sourced System and GDPR

- [How to deal with privacy and GDPR in Event-Driven systems](https://event-driven.io/en/gdpr_in_event_driven_architecture/#crypto-shredding)
- [Protecting Sensitive Data in Event-Sourced Systems with Crypto Shredding](https://www.kurrent.io/blog/protecting-sensitive-data-in-event-sourced-systems-with-crypto-shredding-1)

### Key Management & Compliance

- [Key Management Best Practices](https://cheatsheetseries.owasp.org/cheatsheets/Key_Management_Cheat_Sheet.html) - OWASP guidelines
- [Key Rotation Strategies](https://cloud.google.com/kms/docs/key-rotation) - Google Cloud KMS guide
- [GDPR Compliance Guide](https://gdpr.eu/) - General Data Protection Regulation
- [HIPAA Encryption Requirements](https://www.hhs.gov/hipaa/for-professionals/security/laws-regulations/index.html) - Healthcare data protection
- [What is SOC 2 Compliance? A Beginner's Guide](https://drata.com/blog/beginners-guide-to-soc-2-compliance)
