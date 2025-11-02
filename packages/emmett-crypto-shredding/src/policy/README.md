# Policy

Policy utilities define what streams should be encrypted and with which algorithm.
They are runtime-agnostic and work alongside your `KeyManagement` and `CryptoProvider`.

This folder contains helpers to generate baseline policy sets and guidance on resolving policies.

## What is a Policy?

A policy describes whether events in a stream type should be encrypted and which algorithm to use.
Policies are typically scoped by `partition` (your multi-tenant partition) and `streamTypeClass`.

```ts
type PolicyConfig = {
  policyId: string;
  streamTypeClass: string;      // e.g. "user-data", "audit-log", "*" (wildcard)
  encryptionAlgorithm: "AES-GCM" | "AES-CBC" | "AES-CTR";
  keyRotationIntervalDays: number;
  keyScope: "stream" | "type" | "partition";  // Key management scope
  partition: string;
};
```

**Note:** Policy existence means encryption is required. If no policy exists for a stream type, encryption is not applied.

## Exports

```ts
import {
  getDefaultPolicies,
  type PolicyConfig,
} from "@wataruoguchi/emmett-crypto-shredding";
```

## Default Policies

Use `getDefaultPolicies(partition)` to bootstrap sensible defaults for a tenant/partition. 
These can be inserted into your `encryption_policies` table.

```ts
import { getDefaultPolicies } from "@wataruoguchi/emmett-crypto-shredding";

const policies = getDefaultPolicies("tenant-123");
// Example output (IDs are derived for convenience):
// [
//   { policyId: 'tenant-123-user-data', streamTypeClass: 'user-data', encryptionAlgorithm: 'AES-GCM', keyRotationIntervalDays: 180, keyScope: 'stream', partition: 'tenant-123' },
//   { policyId: 'tenant-123-audit-log', streamTypeClass: 'audit-log', encryptionAlgorithm: 'AES-GCM', keyRotationIntervalDays: 365, keyScope: 'stream', partition: 'tenant-123' },
// ]
```

### Batch Insert Example (Kysely)

```ts
// db: DatabaseExecutor (Kysely)
import { getDefaultPolicies, type PolicyConfig } from "@wataruoguchi/emmett-crypto-shredding";

async function createDefaultPolicies(db: any, partition: string) {
  const defaults = getDefaultPolicies(partition);
  await db
    .insertInto("encryption_policies")
    .values(
      defaults.map((p: PolicyConfig) => ({
        policy_id: p.policyId,
        partition: p.partition,
        stream_type_class: p.streamTypeClass,
        encryption_algorithm: p.encryptionAlgorithm,
        key_rotation_interval_days: p.keyRotationIntervalDays,
        key_scope: p.keyScope,
      })),
    )
    .execute();
}
```

## Resolution Hierarchy (Recommended)

When deciding whether to encrypt a stream, resolve policies in this order:

1. Specific: `partition = <id>` AND `stream_type_class = <type>`
2. Wildcard per partition: `partition = <id>` AND `stream_type_class = "*"`
3. Global default per type: `partition = "*"` AND `stream_type_class = <type>`
4. Global wildcard: `partition = "*"` AND `stream_type_class = "*"`

Notes:

- The schema uses `partition` as `NOT NULL`, so `"*"` is used to represent a wildcard.
- **Policy existence = encryption required.** If no policy is found, default to `encrypt: false`.

## Best Practices

- Keep algorithms simple: prefer `AES-GCM` unless you have a strong reason.
- Use batch inserts for policy provisioning to reduce DB round trips.
- Organize policies per domain (`user-data`, `audit-log`, `financial-data`, etc.).
- Store `keyRotationIntervalDays` for operational tooling; rotation itself is managed by your `KeyManagement` implementation.

## Related API

- `EncryptionPolicyResolver`: your runtime lookup that queries `encryption_policies` and returns either `{ encrypt: true, algo, keyRef }` or `{ encrypt: false }`.
- `KeyManagement`: provides the active key for the chosen `keyRef` in a partition.
- `CryptoProvider`: performs encryption/decryption (e.g., Web Crypto provider).
