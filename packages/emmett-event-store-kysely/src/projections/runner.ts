import type { Event } from "@event-driven-io/emmett";
import type { Kysely, OnConflictBuilder } from "kysely";
import type { EventStoreDBSchema } from "../db-schema.js";
import type { KyselyEventStore } from "../event-store/kysely-event-store.js";
import type { ProjectionEvent, ProjectionRegistry } from "../types.js";

export type SubscriptionCheckpoint = {
  subscriptionId: string;
  partition: string;
  lastProcessedPosition: bigint;
};

/**
 * Flexible database type for projection runner.
 * Uses `Kysely<any> | any` to work around Kysely's private field variance issue.
 */
export type ProjectionRunnerDeps = {
  db: Kysely<any> | any;
  readStream: KyselyEventStore["readStream"];
  registry: ProjectionRegistry;
};

export type ProjectEvents = (
  subscriptionId: string,
  streamId: string,
  opts?: { partition?: string; batchSize?: number },
) => Promise<{ processed: number; currentStreamVersion: bigint }>;

export function createProjectionRunner({
  db,
  readStream,
  registry,
}: ProjectionRunnerDeps): { projectEvents: ProjectEvents } {
  type EventWithMetadata = Event & {
    metadata: {
      streamId: string;
      streamPosition: bigint;
      globalPosition: bigint;
    };
  };

  async function getOrCreateCheckpoint(
    executor: Kysely<any> | any,
    subscriptionId: string,
    partition: string,
  ): Promise<SubscriptionCheckpoint> {
    const existing = await executor
      .selectFrom("subscriptions")
      .select([
        "subscription_id as subscriptionId",
        "partition",
        "last_processed_position as lastProcessedPosition",
      ])
      .where("subscription_id", "=", subscriptionId)
      .where("partition", "=", partition)
      .executeTakeFirst();

    if (existing) {
      const last = BigInt(
        String(
          (existing as unknown as { lastProcessedPosition: bigint })
            .lastProcessedPosition,
        ),
      );
      return {
        subscriptionId,
        partition,
        lastProcessedPosition: last,
      };
    }

    await executor
      .insertInto("subscriptions")
      .values({
        subscription_id: subscriptionId,
        partition,
        version: 1,
        last_processed_position: 0n,
      })
      .onConflict(
        (oc: OnConflictBuilder<EventStoreDBSchema, "subscriptions">) =>
          oc.columns(["subscription_id", "partition", "version"]).doUpdateSet({
            last_processed_position: (eb) =>
              eb.ref("excluded.last_processed_position"),
          }),
      )
      .execute();

    return {
      subscriptionId,
      partition,
      lastProcessedPosition: 0n,
    };
  }

  async function updateCheckpoint(
    executor: Kysely<any> | any,
    subscriptionId: string,
    partition: string,
    lastProcessedPosition: bigint,
  ) {
    await executor
      .updateTable("subscriptions")
      .set({ last_processed_position: lastProcessedPosition })
      .where("subscription_id", "=", subscriptionId)
      .where("partition", "=", partition)
      .execute();
  }

  async function projectEvents(
    subscriptionId: string,
    streamId: string,
    opts?: { partition?: string; batchSize?: number },
  ) {
    const partition = opts?.partition ?? "default_partition";
    const batchSize = BigInt(opts?.batchSize ?? 500);

    // Read checkpoint outside transaction to avoid holding locks during event reading
    const checkpoint = await getOrCreateCheckpoint(
      db,
      subscriptionId,
      partition,
    );

    // Read events outside transaction - this is just a read operation
    const { events, currentStreamVersion } =
      await readStream<EventWithMetadata>(streamId, {
        from: checkpoint.lastProcessedPosition + 1n,
        to: checkpoint.lastProcessedPosition + batchSize,
        partition,
      });

    let processed = 0;

    // Process each event in its own transaction
    // This keeps transactions short and reduces lock contention
    for (const ev of events) {
      if (!ev) continue;

      // Each event gets its own transaction
      // This ensures atomicity per event while keeping transactions short
      await db.transaction().execute(async (trx: Kysely<any> | any) => {
        const handlers = registry[ev.type] ?? [];
        if (handlers.length === 0) {
          // No handlers, just update checkpoint
          await updateCheckpoint(
            trx,
            subscriptionId,
            partition,
            ev.metadata.streamPosition,
          );
          return;
        }

        const projectionEvent: ProjectionEvent<{
          type: string;
          data: unknown;
        }> = {
          type: ev.type,
          data: ev.data,
          metadata: {
            streamId: ev.metadata.streamId,
            streamPosition: ev.metadata.streamPosition,
            globalPosition: ev.metadata.globalPosition,
          },
        };

        // All handlers for this event run in the same transaction
        // This ensures they see each other's changes and maintain consistency
        for (const handler of handlers) {
          await handler({ db: trx, partition }, projectionEvent);
        }

        // Update checkpoint after all handlers succeed
        await updateCheckpoint(
          trx,
          subscriptionId,
          partition,
          projectionEvent.metadata.streamPosition,
        );
      });

      processed++;
    }

    return { processed, currentStreamVersion };
  }

  return { projectEvents };
}
