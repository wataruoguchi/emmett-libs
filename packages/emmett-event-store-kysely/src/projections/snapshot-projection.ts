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
   * The primary key columns that uniquely identify a row
   * e.g., ['tenant_id', 'cart_id', 'partition']
   */
  primaryKeys: string[];

  /**
   * Extract primary key values from the event data
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
 *   primaryKeys: ['tenant_id', 'cart_id', 'partition'],
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
  const {
    tableName,
    primaryKeys,
    extractKeys,
    evolve,
    initialState,
    mapToColumns,
  } = config;

  return async (
    { db, partition }: ProjectionContext<DatabaseExecutor>,
    event: ProjectionEvent<E>,
  ) => {
    const keys = extractKeys(event, partition);

    // Check if event is newer than what we've already processed
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
      .executeTakeFirst();

    const lastPos = existing?.last_stream_position
      ? BigInt(String(existing.last_stream_position))
      : -1n;

    // Skip if we've already processed a newer event
    if (event.metadata.streamPosition <= lastPos) {
      return;
    }

    // Load current state from snapshot or use initial state
    // Note: snapshot is stored as JSONB and Kysely returns it as parsed JSON
    const currentState: TState = existing?.snapshot
      ? (existing.snapshot as unknown as TState)
      : initialState();

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

    // If mapToColumns is provided, also update the denormalized columns
    if (mapToColumns) {
      const columns = mapToColumns(newState);
      for (const columnName of Object.keys(columns)) {
        updateSet[columnName] = (eb) => eb.ref(`excluded.${columnName}`);
      }
    }

    await insertQuery
      // Note: `any` is used here because the conflict builder needs to work with any table schema.
      // The actual schema is validated at runtime through Kysely's query builder.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .onConflict((oc: OnConflictBuilder<DatabaseExecutor, any>) => {
        const conflictBuilder = oc.columns(primaryKeys);
        return conflictBuilder.doUpdateSet(updateSet);
      })
      .execute();
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
 *     primaryKeys: ['tenant_id', 'cart_id', 'partition'],
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
