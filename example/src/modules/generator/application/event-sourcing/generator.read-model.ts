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
  createEvolve,
  initialState as generatorInitialState,
  type GeneratorDomainEvent,
  type GeneratorDomainState,
} from "./generator.event-handler.js";

/**
 * Snapshot-based projection for generators.
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
 * const registry = generatorsSnapshotProjection();
 * const runner = createProjectionRunner({ db, readStream, registry });
 * await runner.projectEvents('subscription-id', 'stream-id', { partition: 'tenant-123' });
 * ```
 */
export function generatorsSnapshotProjection(): ProjectionRegistry<DatabaseExecutor> {
  // Reuse the exact same evolve logic from the domain event handler!
  // This ensures consistency between write and read models.
  const domainEvolve = createEvolve();

  // Wrapper to adapt ProjectionEvent to the domain evolve function
  // The discriminated union is preserved through the type system!
  const evolve = (
    state: GeneratorDomainState,
    event: ProjectionEvent<GeneratorDomainEvent>,
  ): GeneratorDomainState => {
    // TypeScript now correctly narrows event.data based on event.type
    return domainEvolve(state, event);
  };

  return createSnapshotProjectionRegistry<
    GeneratorDomainState,
    "generators",
    GeneratorDomainEvent
  >(["GeneratorCreated", "GeneratorUpdated", "GeneratorDeleted"], {
    tableName: "generators",
    extractKeys: (
      event: ProjectionEvent<GeneratorDomainEvent>,
      partition: string,
    ) => {
      // TypeScript now knows that all GeneratorDomainEvent variants have eventMeta!
      return {
        tenant_id: event.data.eventMeta.tenantId,
        generator_id: event.data.eventMeta.generatorId,
        partition,
      };
    },
    evolve,
    initialState: generatorInitialState,
    // Map snapshot state to denormalized columns for easier querying
    mapToColumns: (state: GeneratorDomainState) => ({
      name: state.data?.name ?? null,
      address: state.data?.address ?? null,
      generator_type: state.data?.generatorType ?? null,
      notes: state.data?.notes ?? null,
      is_deleted: state.status === "deleted",
    }),
  });
}

/**
 * Creates a consumer that automatically processes generator events using snapshot-based projections.
 *
 * This consumer uses `generatorsSnapshotProjection()` which stores the full aggregate state
 * in the `snapshot` JSONB column.
 *
 * **When to use this:**
 * - In production for continuous, automatic read model updates
 * - When you want background processing with automatic checkpointing
 * - For real-time or near-real-time read model consistency
 *
 * **When NOT to use this:**
 * - In tests where you need synchronous, on-demand projection - use `generatorsSnapshotProjection()` with `createProjectionRunner` instead
 *
 * @param db - Database executor instance
 * @param logger - Logger instance
 * @param partition - Partition to process (typically tenant ID)
 * @param consumerName - Optional custom consumer name for tracking
 * @param batchSize - Optional batch size for processing events (default: 100)
 * @param pollingInterval - Optional polling interval in milliseconds (default: 1000)
 * @returns Consumer instance with start/stop methods
 */
export function createGeneratorsConsumer({
  db,
  logger,
  partition,
  consumerName = "generators-read-model",
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
  const registry = generatorsSnapshotProjection();

  for (const [eventType, handlers] of Object.entries(registry)) {
    for (const handler of handlers as ProjectionHandler<DatabaseExecutor>[]) {
      consumer.subscribe(
        async (
          event: ReadEvent<Event, ReadEventMetadataWithGlobalPosition>,
        ) => {
          // Convert consumer event to projection event format
          const projectionEvent: ProjectionEvent<GeneratorDomainEvent> = {
            type: event.type,
            data: event.data,
            metadata: {
              streamId: event.metadata.streamName,
              streamPosition: event.metadata.streamPosition,
              globalPosition: event.metadata.globalPosition,
            },
          } as ProjectionEvent<GeneratorDomainEvent>;

          await handler({ db, partition }, projectionEvent);
        },
        eventType,
      );
    }
  }

  return consumer;
}
