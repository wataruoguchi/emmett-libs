import type {
  Event,
  ReadEvent,
  ReadEventMetadataWithGlobalPosition,
} from "@event-driven-io/emmett";
import type { Dependencies } from "../types.js";

export type KyselyEventStoreConsumerConfig = {
  /** Consumer name for tracking subscription state */
  consumerName?: string;
  /** Batch size for processing events */
  batchSize?: number;
  /** Polling interval in milliseconds */
  pollingInterval?: number;
};

export type KyselyEventStoreConsumer = {
  /** Start consuming events */
  start(): Promise<void>;
  /** Stop consuming events */
  stop(): Promise<void>;
  /** Subscribe to specific event types */
  subscribe<EventType extends Event>(
    handler: (
      event: ReadEvent<EventType, ReadEventMetadataWithGlobalPosition>,
    ) => Promise<void> | void,
    eventType: string,
  ): void;
  /** Subscribe to all events */
  subscribeToAll(
    handler: (
      event: ReadEvent<Event, ReadEventMetadataWithGlobalPosition>,
    ) => Promise<void> | void,
  ): void;
};

export function createKyselyEventStoreConsumer({
  db,
  logger,
  consumerName = "default-consumer",
  batchSize = 100,
  pollingInterval = 1000,
}: Dependencies & KyselyEventStoreConsumerConfig): KyselyEventStoreConsumer {
  let isRunning = false;
  let lastProcessedPosition = 0n;
  const eventHandlers = new Map<
    string,
    Array<
      (
        event: ReadEvent<Event, ReadEventMetadataWithGlobalPosition>,
      ) => Promise<void> | void
    >
  >();
  const allEventHandlers: Array<
    (
      event: ReadEvent<Event, ReadEventMetadataWithGlobalPosition>,
    ) => Promise<void> | void
  > = [];
  let pollingTimer: NodeJS.Timeout | null = null;

  const processEvents = async () => {
    if (!isRunning) return;

    try {
      // Get events from the last processed position
      const events = await db
        .selectFrom("messages")
        .select([
          "message_type",
          "message_data",
          "message_metadata",
          "stream_position",
          "global_position",
          "message_id",
          "stream_id",
        ])
        .where("global_position", ">", lastProcessedPosition)
        .where("is_archived", "=", false)
        .orderBy("global_position")
        .limit(batchSize)
        .execute();

      if (events.length === 0) {
        return;
      }

      // Process each event
      for (const row of events) {
        const event: ReadEvent<Event, ReadEventMetadataWithGlobalPosition> = {
          kind: "Event" as const,
          type: row.message_type,
          data: row.message_data,
          metadata: {
            ...(row.message_metadata as Record<string, unknown>),
            messageId: row.message_id,
            streamName: row.stream_id,
            streamPosition: BigInt(String(row.stream_position)),
            globalPosition: BigInt(String(row.global_position)),
          },
        };

        // Call type-specific handlers
        const typeHandlers = eventHandlers.get(row.message_type) || [];
        for (const handler of typeHandlers) {
          try {
            await handler(event);
          } catch (error) {
            logger.error(
              { error, event },
              `Error processing event ${row.message_type}`,
            );
          }
        }

        // Call all-event handlers
        for (const handler of allEventHandlers) {
          try {
            await handler(event);
          } catch (error) {
            logger.error(
              { error, event },
              "Error processing event in all-event handler",
            );
          }
        }

        // Update last processed position
        const globalPos = row.global_position;
        if (globalPos !== null) {
          lastProcessedPosition = BigInt(String(globalPos));
        }
      }

      // Update subscription tracking
      await updateSubscriptionPosition();
    } catch (error) {
      logger.error({ error }, "Error processing events");
    }
  };

  const updateSubscriptionPosition = async () => {
    try {
      await db
        .insertInto("subscriptions")
        .values({
          consumer_name: consumerName,
          last_processed_position: lastProcessedPosition,
          last_processed_transaction_id: lastProcessedPosition,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .onConflict((oc: any) =>
          oc.column("consumer_name").doUpdateSet({
            last_processed_position: lastProcessedPosition,
            last_processed_transaction_id: lastProcessedPosition,
            updated_at: new Date(),
          }),
        )
        .execute();
    } catch (error) {
      logger.error({ error }, "Error updating subscription position");
    }
  };

  const loadLastProcessedPosition = async () => {
    try {
      const subscription = await db
        .selectFrom("subscriptions")
        .select(["last_processed_position"])
        .where("consumer_name", "=", consumerName)
        .executeTakeFirst();

      if (subscription) {
        lastProcessedPosition = BigInt(
          String(subscription.last_processed_position),
        );
      }
    } catch (error) {
      logger.error({ error }, "Error loading last processed position");
    }
  };

  return {
    async start() {
      if (isRunning) return;

      isRunning = true;
      await loadLastProcessedPosition();

      logger.info({ consumerName }, "Starting event store consumer");

      pollingTimer = setInterval(processEvents, pollingInterval);
    },

    async stop() {
      if (!isRunning) return;

      isRunning = false;

      if (pollingTimer) {
        clearInterval(pollingTimer);
        pollingTimer = null;
      }

      logger.info({ consumerName }, "Stopped event store consumer");
    },

    subscribe<EventType extends Event>(
      handler: (
        event: ReadEvent<EventType, ReadEventMetadataWithGlobalPosition>,
      ) => Promise<void> | void,
      eventType: string,
    ) {
      if (!eventHandlers.has(eventType)) {
        eventHandlers.set(eventType, []);
      }
      const handlers = eventHandlers.get(eventType);
      if (handlers) {
        // Type assertion needed because we're storing handlers for specific event types
        // in a generic Map that accepts Event handlers
        handlers.push(
          handler as (
            event: ReadEvent<Event, ReadEventMetadataWithGlobalPosition>,
          ) => Promise<void> | void,
        );
      }
    },

    subscribeToAll(
      handler: (
        event: ReadEvent<Event, ReadEventMetadataWithGlobalPosition>,
      ) => Promise<void> | void,
    ) {
      allEventHandlers.push(handler);
    },
  };
}

// Helper function to create consumer with default options
export function createKyselyEventStoreConsumerWithDefaults(
  deps: Dependencies,
  config: KyselyEventStoreConsumerConfig = {},
): KyselyEventStoreConsumer {
  return createKyselyEventStoreConsumer({
    ...deps,
    ...config,
  });
}
