import type { ExpressionBuilder, OnConflictBuilder } from "kysely";
import type {
  DatabaseExecutor,
  ProjectionContext,
  ProjectionEvent,
  ProjectionHandler,
  ProjectionRegistry,
} from "../types.js";

/**
 * Configuration for snapshot-based projections.
 *
 * @template TState - The aggregate state type that will be stored in the snapshot
 * @template TTable - The table name as a string literal type
 * @template E - The event union type (must be a discriminated union with type and data properties)
 */
export type SnapshotProjectionConfig<
  TState,
  TTable extends string,
  E extends { type: string; data: unknown } = { type: string; data: unknown },
> = {
  /**
   * The name of the database table for this projection
   */
  tableName: TTable;

  /**
   * @deprecated The primary key columns are now automatically inferred from the keys returned by extractKeys.
   * This field is optional and will be removed in a future version.
   *
   * If provided, it will be validated against the keys returned by extractKeys.
   * e.g., ['tenant_id', 'cart_id', 'partition']
   */
  primaryKeys?: string[];

  /**
   * Extract primary key values from the event data.
   * The keys of the returned object will be used as the primary key columns for upsert operations.
   */
  extractKeys: (
    event: ProjectionEvent<E>,
    partition: string,
  ) => Record<string, string>;

  /**
   * The evolve function that takes current state and event, returns new state.
   * This is the same evolve function used in the aggregate.
   */
  evolve: (state: TState, event: ProjectionEvent<E>) => TState;

  /**
   * Initial state for the aggregate when no snapshot exists
   */
  initialState: () => TState;

  /**
   * Optional: Map the snapshot state to individual columns for easier querying.
   * This allows you to denormalize specific fields from the snapshot into table columns.
   *
   * @example
   * ```typescript
   * mapToColumns: (state) => ({
   *   currency: state.currency,
   *   items_json: JSON.stringify(state.items),
   *   is_checked_out: state.status === 'checkedOut'
   * })
   * ```
   */
  mapToColumns?: (state: TState) => Record<string, unknown>;
};

/**
 * Constructs a deterministic stream_id from the keys.
 * The stream_id is created by sorting the keys and concatenating them with a delimiter.
 * This ensures the same keys always produce the same stream_id.
 *
 * URL encoding is used to handle special characters (like `|` and `:`) in key names or values
 * that could otherwise cause collisions or parsing issues when used as delimiters.
 */
function constructStreamId(keys: Record<string, string>): string {
  const sortedEntries = Object.entries(keys).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return sortedEntries
    .map(([key, value]) => {
      const encodedKey = encodeURIComponent(key);
      const encodedValue = encodeURIComponent(value);
      return `${encodedKey}:${encodedValue}`;
    })
    .join("|");
}

/**
 * Validates and caches primary keys from extractKeys.
 * Ensures that extractKeys returns a consistent set of keys across all events.
 */
function validateAndCachePrimaryKeys(
  keys: Record<string, string>,
  tableName: string,
  cachedKeys: string[] | undefined,
): string[] {
  const currentKeys = Object.keys(keys);
  const sortedCurrentKeys = [...currentKeys].sort();

  if (!cachedKeys) {
    // Cache the initially inferred primary keys in a deterministic order
    return sortedCurrentKeys;
  }

  // Validate that subsequent calls to extractKeys return the same key set
  if (
    cachedKeys.length !== sortedCurrentKeys.length ||
    !cachedKeys.every((key, index) => key === sortedCurrentKeys[index])
  ) {
    throw new Error(
      `Snapshot projection "${tableName}" received inconsistent primary keys from extractKeys. ` +
        `Expected keys: ${cachedKeys.join(", ")}, ` +
        `but received: ${sortedCurrentKeys.join(", ")}. ` +
        `Ensure extractKeys returns a consistent set of keys for all events.`,
    );
  }

  return cachedKeys;
}

/**
 * Checks if the event should be processed based on the last processed position.
 * Returns true if the event should be skipped (already processed or older).
 * Uses -1n as the default to indicate no previous position (process from beginning).
 */
function shouldSkipEvent(
  eventPosition: bigint,
  lastProcessedPosition: bigint,
): boolean {
  return eventPosition <= lastProcessedPosition;
}

/**
 * Loads the current state from a snapshot, handling both string and parsed JSON formats.
 * Falls back to initial state if no snapshot exists.
 */
function loadStateFromSnapshot<TState>(
  snapshot: unknown,
  initialState: () => TState,
): TState {
  if (!snapshot) {
    return initialState();
  }

  // Some database drivers return JSONB as strings, others as parsed objects
  if (typeof snapshot === "string") {
    return JSON.parse(snapshot) as TState;
  }

  return snapshot as unknown as TState;
}

/**
 * Builds the update set for denormalized columns from mapToColumns.
 * Returns an empty object if mapToColumns is not provided.
 */
function buildDenormalizedUpdateSet<TState>(
  newState: TState,
  mapToColumns?: (state: TState) => Record<string, unknown>,
): Record<string, (eb: ExpressionBuilder<DatabaseExecutor, any>) => unknown> {
  const updateSet: Record<
    string,
    (eb: ExpressionBuilder<DatabaseExecutor, any>) => unknown
  > = {};

  if (mapToColumns) {
    const columns = mapToColumns(newState);
    for (const columnName of Object.keys(columns)) {
      updateSet[columnName] = (eb) => eb.ref(`excluded.${columnName}`);
    }
  }

  return updateSet;
}

/**
 * Creates a projection handler that stores the aggregate state as a snapshot.
 *
 * This is a generic helper that works with any aggregate that follows the evolve pattern.
 * Instead of manually mapping event fields to table columns, it:
 * 1. Loads the current snapshot from the database (or starts with initial state)
 * 2. Applies the event using the evolve function
 * 3. Stores the new state back to the snapshot column
 *
 * @example
 * ```typescript
 * const cartProjection = createSnapshotProjection({
 *   tableName: 'carts',
 *   extractKeys: (event, partition) => ({
 *     tenant_id: event.data.eventMeta.tenantId,
 *     cart_id: event.data.eventMeta.cartId,
 *     partition
 *   }),
 *   evolve: cartEvolve,
 *   initialState: () => ({ status: 'init', items: [] })
 * });
 *
 * // Use it in a projection registry
 * const registry: ProjectionRegistry = {
 *   CartCreated: [cartProjection],
 *   ItemAddedToCart: [cartProjection],
 *   // ... other events
 * };
 * ```
 */
export function createSnapshotProjection<
  TState,
  TTable extends string,
  E extends { type: string; data: unknown } = { type: string; data: unknown },
>(
  config: SnapshotProjectionConfig<TState, TTable, E>,
): ProjectionHandler<DatabaseExecutor, E> {
  const { tableName, extractKeys, evolve, initialState, mapToColumns } = config;

  // Cache the inferred primary keys after the first call
  let inferredPrimaryKeys: string[] | undefined;

  return async (
    { db, partition }: ProjectionContext<DatabaseExecutor>,
    event: ProjectionEvent<E>,
  ) => {
    const keys = extractKeys(event, partition);

    // Validate and cache primary keys
    inferredPrimaryKeys = validateAndCachePrimaryKeys(
      keys,
      tableName,
      inferredPrimaryKeys,
    );
    const primaryKeys = inferredPrimaryKeys;

    // Check if event is newer than what we've already processed
    // Use FOR UPDATE to lock the row and prevent race conditions with concurrent transactions
    // Note: Casting to `any` is necessary because Kysely cannot infer types for dynamic table names.
    // The table name is provided at runtime, so TypeScript cannot verify the table structure at compile time.
    // This is a known limitation when working with dynamic table names in Kysely.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existing = await (db as any)
      .selectFrom(tableName)
      .select(["last_stream_position", "snapshot"])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .where((eb: ExpressionBuilder<DatabaseExecutor, any>) => {
        const conditions = Object.entries(keys).map(([key, value]) =>
          eb(key, "=", value),
        );
        return eb.and(conditions);
      })
      .forUpdate()
      .executeTakeFirst();

    const lastPos = existing?.last_stream_position
      ? BigInt(String(existing.last_stream_position))
      : -1n;

    // Skip if we've already processed a newer event
    if (shouldSkipEvent(event.metadata.streamPosition, lastPos)) {
      return;
    }

    // Load current state from snapshot or use initial state
    const currentState: TState = loadStateFromSnapshot(
      existing?.snapshot,
      initialState,
    );

    // Apply the event to get new state
    const newState = evolve(currentState, event);

    // Prepare the row data with snapshot
    const rowData: Record<string, unknown> = {
      ...keys,
      snapshot: JSON.stringify(newState),
      stream_id: event.metadata.streamId,
      last_stream_position: event.metadata.streamPosition.toString(),
      last_global_position: event.metadata.globalPosition.toString(),
    };

    // If mapToColumns is provided, add the denormalized columns
    if (mapToColumns) {
      const columns = mapToColumns(newState);
      Object.assign(rowData, columns);
    }

    // Upsert the snapshot
    const insertQuery = db.insertInto(tableName).values(rowData);

    // Build the update set for conflict resolution
    type UpdateValue = (
      eb: ExpressionBuilder<DatabaseExecutor, any>,
    ) => unknown;
    const updateSet: Record<string, UpdateValue> = {
      snapshot: (eb) => eb.ref("excluded.snapshot"),
      stream_id: (eb) => eb.ref("excluded.stream_id"),
      last_stream_position: (eb) => eb.ref("excluded.last_stream_position"),
      last_global_position: (eb) => eb.ref("excluded.last_global_position"),
    };

    // Add denormalized columns to update set if provided
    const denormalizedUpdateSet = buildDenormalizedUpdateSet(
      newState,
      mapToColumns,
    );
    Object.assign(updateSet, denormalizedUpdateSet);

    await insertQuery
      // Note: `any` is used here because the conflict builder needs to work with any table schema.
      // The actual schema is validated at runtime through Kysely's query builder.
      // The FOR UPDATE lock above ensures that concurrent transactions wait, preventing race conditions.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .onConflict((oc: OnConflictBuilder<DatabaseExecutor, any>) => {
        const conflictBuilder = oc.columns(primaryKeys);
        // Note: We could add a WHERE clause here to only update if excluded.last_stream_position > table.last_stream_position,
        // but Kysely's API doesn't easily support this. The FOR UPDATE lock above provides the primary protection.
        return conflictBuilder.doUpdateSet(updateSet);
      })
      .execute();
  };
}

/**
 * Creates a projection handler that stores snapshots in a separate centralized table.
 *
 * This is similar to `createSnapshotProjection`, but uses a separate `snapshots` table
 * to store event-sourcing-related columns. This approach makes read model tables cleaner
 * and more scalable, as they don't need to include event-sourcing columns.
 *
 * **Key differences from `createSnapshotProjection`:**
 * - Snapshots are stored in a centralized `snapshots` table
 * - Read model tables only contain keys from `extractKeys` and columns from `mapToColumns`
 * - The `stream_id` is deterministically constructed from the keys (not from event metadata)
 *
 * **Database schema required:**
 * ```sql
 * CREATE TABLE snapshots (
 *   readmodel_table_name TEXT NOT NULL,
 *   stream_id TEXT NOT NULL,
 *   last_stream_position BIGINT NOT NULL,
 *   last_global_position BIGINT NOT NULL,
 *   snapshot JSONB NOT NULL,
 *   PRIMARY KEY (readmodel_table_name, stream_id)
 * );
 * ```
 *
 * @example
 * ```typescript
 * const cartProjection = createSnapshotProjectionWithSnapshotTable({
 *   tableName: 'carts',
 *   extractKeys: (event, partition) => ({
 *     tenant_id: event.data.eventMeta.tenantId,
 *     cart_id: event.data.eventMeta.cartId,
 *     partition
 *   }),
 *   evolve: cartEvolve,
 *   initialState: () => ({ status: 'init', items: [] }),
 *   mapToColumns: (state) => ({
 *     currency: state.currency,
 *     is_checked_out: state.status === 'checkedOut'
 *   })
 * });
 *
 * // Use it in a projection registry
 * const registry: ProjectionRegistry = {
 *   CartCreated: [cartProjection],
 *   ItemAddedToCart: [cartProjection],
 *   // ... other events
 * };
 * ```
 */
export function createSnapshotProjectionWithSnapshotTable<
  TState,
  TTable extends string,
  E extends { type: string; data: unknown } = { type: string; data: unknown },
>(
  config: SnapshotProjectionConfig<TState, TTable, E>,
): ProjectionHandler<DatabaseExecutor, E> {
  const { tableName, extractKeys, evolve, initialState, mapToColumns } = config;

  // Cache the inferred primary keys after the first call
  let inferredPrimaryKeys: string[] | undefined;

  return async (
    { db, partition }: ProjectionContext<DatabaseExecutor>,
    event: ProjectionEvent<E>,
  ) => {
    const keys = extractKeys(event, partition);

    // Validate and cache primary keys
    inferredPrimaryKeys = validateAndCachePrimaryKeys(
      keys,
      tableName,
      inferredPrimaryKeys,
    );
    const primaryKeys = inferredPrimaryKeys;

    // Construct deterministic stream_id from keys
    const streamId = constructStreamId(keys);

    // Check if event is newer than what we've already processed
    // Use FOR UPDATE to lock the row and prevent race conditions with concurrent transactions
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existing = await (db as any)
      .selectFrom("snapshots")
      .select(["last_stream_position", "snapshot"])
      .where("readmodel_table_name", "=", tableName)
      .where("stream_id", "=", streamId)
      .forUpdate()
      .executeTakeFirst();

    const lastPos = existing?.last_stream_position
      ? BigInt(String(existing.last_stream_position))
      : -1n;

    // Skip if we've already processed a newer event
    if (shouldSkipEvent(event.metadata.streamPosition, lastPos)) {
      return;
    }

    // Load current state from snapshot or use initial state
    const currentState: TState = loadStateFromSnapshot(
      existing?.snapshot,
      initialState,
    );

    // Apply the event to get new state
    const newState = evolve(currentState, event);

    // Upsert the snapshot in the snapshots table
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any)
      .insertInto("snapshots")
      .values({
        readmodel_table_name: tableName,
        stream_id: streamId,
        snapshot: JSON.stringify(newState),
        last_stream_position: event.metadata.streamPosition.toString(),
        last_global_position: event.metadata.globalPosition.toString(),
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .onConflict((oc: OnConflictBuilder<DatabaseExecutor, any>) => {
        // The FOR UPDATE lock above ensures that concurrent transactions wait, preventing race conditions.
        // Note: We could add a WHERE clause here to only update if excluded.last_stream_position > snapshots.last_stream_position,
        // but Kysely's API doesn't easily support this. The FOR UPDATE lock provides the primary protection.
        return oc.columns(["readmodel_table_name", "stream_id"]).doUpdateSet({
          snapshot: (eb: ExpressionBuilder<DatabaseExecutor, any>) =>
            eb.ref("excluded.snapshot"),
          last_stream_position: (
            eb: ExpressionBuilder<DatabaseExecutor, any>,
          ) => eb.ref("excluded.last_stream_position"),
          last_global_position: (
            eb: ExpressionBuilder<DatabaseExecutor, any>,
          ) => eb.ref("excluded.last_global_position"),
        });
      })
      .execute();

    // Upsert the read model table with keys and denormalized columns only
    const readModelData: Record<string, unknown> = { ...keys };

    if (mapToColumns) {
      const columns = mapToColumns(newState);
      Object.assign(readModelData, columns);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const readModelInsertQuery = (db as any)
      .insertInto(tableName)
      .values(readModelData);

    // Build the update set for conflict resolution (only for denormalized columns)
    const readModelUpdateSet = buildDenormalizedUpdateSet(
      newState,
      mapToColumns,
    );

    // Only update if there are denormalized columns, otherwise just insert (no-op on conflict)
    if (Object.keys(readModelUpdateSet).length > 0) {
      await readModelInsertQuery
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .onConflict((oc: OnConflictBuilder<DatabaseExecutor, any>) => {
          const conflictBuilder = oc.columns(primaryKeys);
          return conflictBuilder.doUpdateSet(readModelUpdateSet);
        })
        .execute();
    } else {
      // If no denormalized columns, use insert with on conflict do nothing
      await readModelInsertQuery
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .onConflict((oc: OnConflictBuilder<DatabaseExecutor, any>) => {
          return oc.columns(primaryKeys).doNothing();
        })
        .execute();
    }
  };
}

/**
 * Creates multiple projection handlers that all use the same snapshot projection logic.
 * This is a convenience function to avoid repeating the same handler for multiple event types.
 *
 * @example
 * ```typescript
 * const registry = createSnapshotProjectionRegistry(
 *   ['CartCreated', 'ItemAddedToCart', 'ItemRemovedFromCart'],
 *   {
 *     tableName: 'carts',
 *     extractKeys: (event, partition) => ({
 *       tenant_id: event.data.eventMeta.tenantId,
 *       cart_id: event.data.eventMeta.cartId,
 *       partition
 *     }),
 *     evolve: cartEvolve,
 *     initialState: () => ({ status: 'init', items: [] })
 *   }
 * );
 * ```
 */
export function createSnapshotProjectionRegistry<
  TState,
  TTable extends string,
  E extends { type: string; data: unknown } = { type: string; data: unknown },
>(
  eventTypes: E["type"][],
  config: SnapshotProjectionConfig<TState, TTable, E>,
): ProjectionRegistry {
  const handler = createSnapshotProjection(config);
  const registry: ProjectionRegistry = {};

  for (const eventType of eventTypes) {
    // Type cast is safe here because ProjectionHandler is contravariant in its event type parameter.
    // A handler for a specific event type E can safely handle any event that matches E's structure.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registry[eventType] = [handler as any];
  }

  return registry;
}

/**
 * Creates multiple projection handlers that all use the same snapshot projection logic
 * with a separate snapshots table. This is a convenience function to avoid repeating
 * the same handler for multiple event types.
 *
 * @example
 * ```typescript
 * const registry = createSnapshotProjectionRegistryWithSnapshotTable(
 *   ['CartCreated', 'ItemAddedToCart', 'ItemRemovedFromCart'],
 *   {
 *     tableName: 'carts',
 *     extractKeys: (event, partition) => ({
 *       tenant_id: event.data.eventMeta.tenantId,
 *       cart_id: event.data.eventMeta.cartId,
 *       partition
 *     }),
 *     evolve: cartEvolve,
 *     initialState: () => ({ status: 'init', items: [] }),
 *     mapToColumns: (state) => ({
 *       currency: state.currency,
 *       is_checked_out: state.status === 'checkedOut'
 *     })
 *   }
 * );
 * ```
 */
export function createSnapshotProjectionRegistryWithSnapshotTable<
  TState,
  TTable extends string,
  E extends { type: string; data: unknown } = { type: string; data: unknown },
>(
  eventTypes: E["type"][],
  config: SnapshotProjectionConfig<TState, TTable, E>,
): ProjectionRegistry {
  const handler = createSnapshotProjectionWithSnapshotTable(config);
  const registry: ProjectionRegistry = {};

  for (const eventType of eventTypes) {
    // Type cast is safe here because ProjectionHandler is contravariant in its event type parameter.
    // A handler for a specific event type E can safely handle any event that matches E's structure.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registry[eventType] = [handler as any];
  }

  return registry;
}
