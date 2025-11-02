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

export function createProjectionRunner({
  db,
  readStream,
  registry,
}: ProjectionRunnerDeps) {
  type EventWithMetadata = Event & {
    metadata: {
      streamId: string;
      streamPosition: bigint;
      globalPosition: bigint;
    };
  };

  async function getOrCreateCheckpoint(
    subscriptionId: string,
    partition: string,
  ): Promise<SubscriptionCheckpoint> {
    const existing = await db
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

    await db
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
    subscriptionId: string,
    partition: string,
    lastProcessedPosition: bigint,
  ) {
    await db
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

    const checkpoint = await getOrCreateCheckpoint(subscriptionId, partition);

    const { events, currentStreamVersion } =
      await readStream<EventWithMetadata>(streamId, {
        from: checkpoint.lastProcessedPosition + 1n,
        to: checkpoint.lastProcessedPosition + batchSize,
        partition,
      });

    for (const ev of events) {
      if (!ev) continue;
      const handlers = registry[ev.type] ?? [];
      if (handlers.length === 0) {
        await updateCheckpoint(
          subscriptionId,
          partition,
          ev.metadata.streamPosition,
        );
        continue;
      }
      const projectionEvent: ProjectionEvent<{ type: string; data: unknown }> =
        {
          type: ev.type,
          data: ev.data,
          metadata: {
            streamId: ev.metadata.streamId,
            streamPosition: ev.metadata.streamPosition,
            globalPosition: ev.metadata.globalPosition,
          },
        };
      for (const handler of handlers) {
        await handler({ db, partition }, projectionEvent);
      }
      await updateCheckpoint(
        subscriptionId,
        partition,
        projectionEvent.metadata.streamPosition,
      );
    }

    return { processed: events.length, currentStreamVersion };
  }

  return { projectEvents };
}
