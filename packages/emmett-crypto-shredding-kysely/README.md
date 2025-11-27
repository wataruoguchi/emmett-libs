# @wataruoguchi/emmett-crypto-shredding-kysely

Kysely adapters for [Emmett Crypto Shredding](https://github.com/wataruoguchi/emmett-libs/tree/main/packages/emmett-crypto-shredding), providing PostgreSQL implementations for key storage and policy storage.

## 📚 Documentation

**👉 [View Complete Documentation →](https://wataruoguchi.github.io/emmett-libs/emmett-crypto-shredding-kysely)**

## What This Package Does

This package provides **Kysely-specific database adapters** for:
- **Key Storage** - PostgreSQL implementation of the `KeyStorage` interface
- **Policy Storage** - PostgreSQL implementation of the `PolicyStorage` interface
- **Policy Management** - Utilities for managing encryption policies in the database

The actual encryption/decryption logic, key rotation, and crypto shredding functionality are provided by [`@wataruoguchi/emmett-crypto-shredding`](https://github.com/wataruoguchi/emmett-libs/tree/main/packages/emmett-crypto-shredding).

## Installation

```bash
npm install @wataruoguchi/emmett-crypto-shredding-kysely @wataruoguchi/emmett-crypto-shredding kysely pg
```

## Quick Start

### 1. Run Database Migration

Copy the migration file from `database/migrations/1761627233034_crypto_shredding.ts` to your migrations directory.

### 2. Create Key Management

```typescript
import { createKeyManagement } from '@wataruoguchi/emmett-crypto-shredding-kysely';
import { Kysely } from 'kysely';

const keyManagement = createKeyManagement(db);
```

### 3. Create Policy Resolver

```typescript
import { createPolicyResolver } from '@wataruoguchi/emmett-crypto-shredding-kysely';

const policyResolver = createPolicyResolver(db, logger);
```

### 4. Create Encryption Policies

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

## API Reference

### Key Management

#### `createKeyManagement(db: Kysely<any> | any): KeyManagement`

Creates a key management service backed by PostgreSQL.

#### `createKeyStorage(db: Kysely<any> | any): KeyStorage`

Creates a lower-level key storage adapter (if you need direct access).

### Policy Resolution

#### `createPolicyResolver(db: Kysely<any> | any, logger?: Logger): EncryptionPolicyResolver`

Creates a policy resolver backed by PostgreSQL.

#### `createPolicyStorage(db: Kysely<any> | any, logger?: Logger): PolicyStorage`

Creates a lower-level policy storage adapter.

### Policy Management

#### `createPolicies(db: Kysely<any> | any, policies: DatabasePolicyConfig[]): Promise<void>`

Create multiple encryption policies in a single batch operation.

#### `createDefaultPolicies(db: Kysely<any> | any, partition: string): Promise<void>`

Create default encryption policies for a partition using the default policy configuration.

#### `updatePolicy(db: Kysely<any> | any, policyId: string, partition: string, updates: {...}): Promise<void>`

Update an existing encryption policy.

#### `deletePolicy(db: Kysely<any> | any, policyId: string, partition: string): Promise<void>`

Delete an encryption policy.

#### `listPolicies(db: Kysely<any> | any, partition: string): Promise<PolicyRecord[]>`

List all policies for a partition.

## See Also

- [Emmett Crypto Shredding Documentation](https://wataruoguchi.github.io/emmett-libs/emmett-crypto-shredding)
- [Example Application](https://github.com/wataruoguchi/emmett-libs/tree/main/example)

## License

MIT
