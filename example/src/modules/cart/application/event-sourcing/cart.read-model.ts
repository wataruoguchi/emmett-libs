import type {
  Event,
  ReadEvent,
  ReadEventMetadataWithGlobalPosition,
} from "@event-driven-io/emmett";
import {
  createKyselyEventStoreConsumer,
  createSnapshotProjectionRegistry,
  type ProjectionEvent,
  type ProjectionHandler,
  type ProjectionRegistry,
} from "@wataruoguchi/emmett-event-store-kysely";
import type { DatabaseExecutor } from "../../../shared/infra/db.js";
import type { Logger } from "../../../shared/infra/logger.js";
import {
  initialState as cartInitialState,
  createEvolve,
  type CartDomainEvent,
  type CartDomainState,
} from "./cart.event-handler.js";

/**
 * Snapshot-based projection for carts.
 *
 * Instead of manually mapping individual fields to columns, this stores the entire
 * aggregate state in the `snapshot` JSONB column. This approach:
 * - Allows reconstructing the full state without replaying all events
 * - Is more flexible (no schema migrations for new fields)
 * - Keeps the projection logic closer to the domain model
 * - Uses the same evolve logic as the write model for consistency
 *
 * @returns ProjectionRegistry mapping event types to snapshot-based handlers
 *
 * @example
 * ```typescript
 * // Use in tests or with projection runner
 * const registry = cartsSnapshotProjection();
 * const runner = createProjectionRunner({ db, readStream, registry });
 * await runner.projectEvents('subscription-id', 'stream-id', { partition: 'tenant-123' });
 * ```
 */
export function cartsSnapshotProjection(): ProjectionRegistry<DatabaseExecutor> {
  // Reuse the exact same evolve logic from the domain event handler!
  // This ensures consistency between write and read models.
  const domainEvolve = createEvolve();

  // Wrapper to adapt ProjectionEvent to the domain evolve function
  // The discriminated union is preserved through the type system!
  const evolve = (
    state: CartDomainState,
    event: ProjectionEvent<CartDomainEvent>,
  ): CartDomainState => {
    // TypeScript now correctly narrows event.data based on event.type
    return domainEvolve(state, event);
  };

  return createSnapshotProjectionRegistry<
    CartDomainState,
    "carts",
    CartDomainEvent
  >(
    [
      "CartCreated",
      "ItemAddedToCart",
      "ItemRemovedFromCart",
      "CartEmptied",
      "CartCheckedOut",
      "CartCancelled",
    ],
    {
      tableName: "carts",
      extractKeys: (
        event: ProjectionEvent<CartDomainEvent>,
        partition: string,
      ) => {
        // TypeScript now knows that all CartDomainEvent variants have eventMeta!
        return {
          tenant_id: event.data.eventMeta.tenantId,
          cart_id: event.data.eventMeta.cartId,
          partition,
        };
      },
      evolve,
      initialState: cartInitialState,
      // Map snapshot state to denormalized columns for easier querying
      mapToColumns: (state: CartDomainState) => {
        // Handle InitCart state (shouldn't normally occur in projections after CartCreated)
        if (state.status === "init") {
          return {
            currency: null,
            total: null,
            order_id: null,
            items_json: JSON.stringify([]),
            is_checked_out: false,
            is_cancelled: false,
          };
        }

        // For all other states that extend BaseCartState
        return {
          currency: state.currency,
          total: state.status === "checkedOut" ? state.total : null,
          order_id: state.status === "checkedOut" ? state.orderId : null,
          items_json: JSON.stringify(state.items),
          is_checked_out: state.status === "checkedOut",
          is_cancelled: state.status === "cancelled",
        };
      },
    },
  );
}

/**
 * Creates a consumer that automatically processes cart events using snapshot-based projections.
 *
 * This consumer uses `cartsSnapshotProjection()` which stores the full aggregate state
 * in the `snapshot` JSONB column.
 *
 * **When to use this:**
 * - In production for continuous, automatic read model updates
 * - When you want background processing with automatic checkpointing
 * - For real-time or near-real-time read model consistency
 *
 * **When NOT to use this:**
 * - In tests where you need synchronous, on-demand projection - use `cartsSnapshotProjection()` with `createProjectionRunner` instead
 *
 * @param db - Database executor instance
 * @param logger - Logger instance
 * @param partition - Partition to process (typically tenant ID)
 * @param consumerName - Optional custom consumer name for tracking
 * @param batchSize - Optional batch size for processing events (default: 100)
 * @param pollingInterval - Optional polling interval in milliseconds (default: 1000)
 * @returns Consumer instance with start/stop methods
 */
export function createCartsConsumer({
  db,
  logger,
  partition,
  consumerName = "carts-read-model",
  batchSize = 100,
  pollingInterval = 1000,
}: {
  db: DatabaseExecutor;
  logger: Logger;
  partition: string;
  consumerName?: string;
  batchSize?: number;
  pollingInterval?: number;
}) {
  const consumer = createKyselyEventStoreConsumer({
    db,
    logger,
    consumerName,
    batchSize,
    pollingInterval,
  });

  // Use snapshot-based projection registry
  const registry = cartsSnapshotProjection();

  for (const [eventType, handlers] of Object.entries(registry)) {
    for (const handler of handlers as ProjectionHandler<DatabaseExecutor>[]) {
      consumer.subscribe(
        async (
          event: ReadEvent<Event, ReadEventMetadataWithGlobalPosition>,
        ) => {
          // Convert consumer event to projection event format
          const projectionEvent: ProjectionEvent<CartDomainEvent> = {
            type: event.type,
            data: event.data,
            metadata: {
              streamId: event.metadata.streamName,
              streamPosition: event.metadata.streamPosition,
              globalPosition: event.metadata.globalPosition,
            },
          } as ProjectionEvent<CartDomainEvent>;

          await handler({ db, partition }, projectionEvent);
        },
        eventType,
      );
    }
  }

  return consumer;
}
