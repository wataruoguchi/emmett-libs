// biome-ignore assist/source/organizeImports: retain import order similar to app code
import {
  assertExpectedVersionMatchesCurrent,
  type AggregateStreamOptions,
  type AggregateStreamResult,
  type AppendToStreamOptions,
  type AppendToStreamResultWithGlobalPosition,
  type Event,
  type EventStore,
  type EventStoreSession,
  type EventStoreSessionFactory,
  type ReadEvent,
  type ReadEventMetadataWithGlobalPosition,
  type ReadStreamOptions,
  type ReadStreamResult,
} from "@event-driven-io/emmett";
import type { Kysely } from "kysely";
import {
  DEFAULT_PARTITION,
  PostgreSQLEventStoreDefaultStreamVersion,
  type Dependencies,
  type ExtendedOptions,
} from "../types.js";

type KyselyReadEventMetadata = ReadEventMetadataWithGlobalPosition;
type ExtendedAppendToStreamOptions = AppendToStreamOptions & ExtendedOptions;
type ExtendedReadStreamOptions = ReadStreamOptions & ExtendedOptions;

// More flexible options for projection runner compatibility
export type ProjectionReadStreamOptions = {
  from?: bigint;
  to?: bigint;
  partition?: string;
  maxCount?: bigint;
};

export interface KyselyEventStore
  extends EventStore<KyselyReadEventMetadata>,
    EventStoreSessionFactory<KyselyEventStore> {
  // Override readStream to accept ProjectionReadStreamOptions
  readStream<EventType extends Event>(
    streamName: string,
    options?: ReadStreamOptions<bigint> | ProjectionReadStreamOptions,
  ): Promise<ReadStreamResult<EventType, KyselyReadEventMetadata>>;
  appendToStream<EventType extends Event>(
    streamName: string,
    events: EventType[],
    options?: ExtendedAppendToStreamOptions,
  ): Promise<AppendToStreamResultWithGlobalPosition>;
  close(): Promise<void>;
  schema: {
    sql(): string;
    print(): void;
    migrate(): Promise<void>;
  };
}

export type KyselyEventStoreOptions = {
  /** Database connection options */
  connectionOptions?: {
    /** Custom database executor (Kysely instance) */
    db?: Kysely<unknown>;
  };
  /** Schema management options */
  schema?: {
    /** Auto-migration strategy */
    autoMigration?: "CreateOrUpdate" | "None";
  };
  /** Hooks for lifecycle events */
  hooks?: {
    /** Called after schema is created */
    onAfterSchemaCreated?: () => Promise<void> | void;
  };
};

export const defaultKyselyOptions: KyselyEventStoreOptions = {
  schema: {
    autoMigration: "CreateOrUpdate",
  },
};

export const getKyselyEventStore = (deps: Dependencies): KyselyEventStore => {
  const { db, logger, inTransaction = false } = deps;

  const eventStore: KyselyEventStore = {
    /**
     * @description We do not use schema management in this package.
     */
    schema: {
      sql: () => "",
      print: () => console.log(""),
      migrate: async () => Promise.resolve(),
    },

    /**
     * Provide a session-bound event store using a Kysely transaction.
     * All operations within the callback will share the same DB transaction.
     */
    async withSession<T = unknown>(
      callback: (session: EventStoreSession<KyselyEventStore>) => Promise<T>,
    ): Promise<T> {
      return await db.transaction().execute(async (trx: any) => {
        const sessionEventStore = getKyselyEventStore({
          db: trx as any,
          logger,
          inTransaction: true,
        });
        return await callback({
          eventStore: sessionEventStore,
          close: () => Promise.resolve(),
        });
      });
    },

    async aggregateStream<State, EventType extends Event>(
      streamName: string,
      options: AggregateStreamOptions<
        State,
        EventType,
        KyselyReadEventMetadata
      >,
    ): Promise<AggregateStreamResult<State>> {
      const { evolve, initialState, read } = options;
      logger.debug?.({ streamName, options }, "aggregateStream");

      const expectedStreamVersion = read?.expectedStreamVersion;

      const result = await eventStore.readStream<EventType>(streamName, read);
      assertExpectedVersionMatchesCurrent(
        result.currentStreamVersion,
        expectedStreamVersion,
        PostgreSQLEventStoreDefaultStreamVersion,
      );

      const state = result.events.reduce(
        (state, event) => (event ? evolve(state, event) : state),
        initialState(),
      );

      return {
        state,
        currentStreamVersion: result.currentStreamVersion,
        streamExists: result.streamExists,
      };
    },

    async readStream<EventType extends Event>(
      streamName: string,
      options?: ReadStreamOptions<bigint> | ProjectionReadStreamOptions,
    ): Promise<ReadStreamResult<EventType, KyselyReadEventMetadata>> {
      const partition = getPartition(options);
      logger.debug?.({ streamName, options, partition }, "readStream");

      const { currentStreamVersion, streamExists } = await fetchStreamInfo(
        db,
        streamName,
        partition,
      );

      const range = parseRangeOptions(options);
      const rows = await buildEventsQuery(
        { db, logger },
        streamName,
        partition,
        range,
      ).execute();

      const events: ReadStreamResult<
        EventType,
        KyselyReadEventMetadata
      >["events"] = rows.map((row) =>
        mapRowToEvent<EventType>(row, streamName),
      );

      return {
        events,
        currentStreamVersion,
        streamExists,
      };
    },

    async appendToStream<EventType extends Event>(
      streamName: string,
      events: EventType[],
      options?: ExtendedAppendToStreamOptions,
    ): Promise<AppendToStreamResultWithGlobalPosition> {
      const streamType = getStreamType(options);
      const partition = getPartition(options);
      const expected = options?.expectedStreamVersion;

      logger.debug?.(
        { streamName, events, options, partition },
        "appendToStream",
      );
      ensureEventsNotEmpty(events, expected);

      // It may be called within a transaction via withSession.
      const executeOn = async (executor: Dependencies["db"]) => {
        const { currentStreamVersion, streamExists } = await fetchStreamInfo(
          executor,
          streamName,
          partition,
        );

        assertExpectedVersion(expected, currentStreamVersion, streamExists);

        const basePos = currentStreamVersion;
        const nextStreamPosition = computeNextStreamPosition(
          basePos,
          events.length,
        );

        await upsertStreamRow(
          executor,
          streamName,
          partition,
          streamType,
          basePos,
          nextStreamPosition,
          expected,
          streamExists,
        );

        const messagesToInsert = buildMessagesToInsert<EventType>(
          events,
          basePos,
          streamName,
          partition,
        );

        const lastEventGlobalPosition =
          await insertMessagesAndGetLastGlobalPosition(
            executor,
            messagesToInsert,
          );

        return {
          nextExpectedStreamVersion: nextStreamPosition,
          lastEventGlobalPosition,
          createdNewStream: !streamExists,
        };
      };

      if (inTransaction) {
        return executeOn(db);
      }
      return db
        .transaction()
        .execute(async (trx: any) => executeOn(trx as any));
    },

    close: async () => {
      // Kysely doesn't require explicit closing for most cases
      // but we can add cleanup logic here if needed
      await Promise.resolve();
    },
  };

  return eventStore;
};

// Helper functions (consolidated from the optimized implementation)

function getStreamType(options?: ExtendedAppendToStreamOptions): string {
  return options?.streamType ?? "unknown";
}

function getPartition(
  options?:
    | ExtendedReadStreamOptions
    | ProjectionReadStreamOptions
    | ExtendedAppendToStreamOptions,
): string {
  return options?.partition ?? DEFAULT_PARTITION;
}

function ensureEventsNotEmpty<EventType extends Event>(
  events: EventType[],
  _expected: AppendToStreamOptions["expectedStreamVersion"] | undefined,
): void {
  if (events.length === 0) {
    throw new Error("Cannot append empty events array");
  }
}

function assertExpectedVersion(
  expected: AppendToStreamOptions["expectedStreamVersion"] | undefined,
  currentPos: bigint,
  streamExistsNow: boolean,
): void {
  if (expected === "STREAM_EXISTS" && !streamExistsNow) {
    throw new Error("Stream does not exist but expected to exist");
  }
  if (expected === "STREAM_DOES_NOT_EXIST" && streamExistsNow) {
    throw new Error("Stream exists but expected not to exist");
  }
  if (typeof expected === "bigint" && expected !== currentPos) {
    throw new Error(
      `Expected version ${expected} but current is ${currentPos}`,
    );
  }
}

function computeNextStreamPosition(
  basePos: bigint,
  eventCount: number,
): bigint {
  return basePos + BigInt(eventCount);
}

async function upsertStreamRow(
  executor: Dependencies["db"],
  streamId: string,
  partition: string,
  streamType: string,
  basePos: bigint,
  nextStreamPosition: bigint,
  expected: AppendToStreamOptions["expectedStreamVersion"] | undefined,
  streamExistsNow: boolean,
): Promise<void> {
  if (!streamExistsNow) {
    await executor
      .insertInto("streams")
      .values({
        stream_id: streamId,
        stream_position: nextStreamPosition,
        partition,
        stream_type: streamType,
        stream_metadata: {},
        is_archived: false,
      })
      .execute();
    return;
  }

  if (typeof expected === "bigint") {
    const updatedRow = await executor
      .updateTable("streams")
      .set({ stream_position: nextStreamPosition })
      .where("stream_id", "=", streamId)
      .where("partition", "=", partition)
      .where("is_archived", "=", false)
      .where("stream_position", "=", basePos)
      .returning("stream_position")
      .executeTakeFirst();
    if (!updatedRow) {
      throw new Error(`Expected version ${expected} but current is ${basePos}`);
    }
    return;
  }

  await executor
    .updateTable("streams")
    .set({ stream_position: nextStreamPosition })
    .where("stream_id", "=", streamId)
    .where("partition", "=", partition)
    .where("is_archived", "=", false)
    .execute();
}

function buildMessagesToInsert<EventType extends Event>(
  events: EventType[],
  basePos: bigint,
  streamId: string,
  partition: string,
) {
  return events.map((e, index) => {
    const messageId = crypto.randomUUID();
    const streamPosition = basePos + BigInt(index + 1);
    const rawMeta = "metadata" in e ? e.metadata : undefined;
    const eventMeta = rawMeta && typeof rawMeta === "object" ? rawMeta : {};
    const messageMetadata = {
      ...eventMeta,
    };
    return {
      stream_id: streamId,
      stream_position: streamPosition,
      partition,
      message_data: e.data as unknown,
      message_metadata: messageMetadata as unknown,
      message_schema_version: index.toString(),
      message_type: e.type,
      message_kind: "E",
      message_id: messageId,
      is_archived: false,
      created: new Date(),
    };
  });
}

async function insertMessagesAndGetLastGlobalPosition(
  executor: Dependencies["db"],
  messagesToInsert: Array<{
    stream_id: string;
    stream_position: bigint;
    partition: string;
    message_data: unknown;
    message_metadata: unknown;
    message_schema_version: string;
    message_type: string;
    message_kind: string;
    message_id: string;
    is_archived: boolean;
    created: Date;
  }>,
): Promise<bigint> {
  const inserted = await executor
    .insertInto("messages")
    .values(messagesToInsert)
    .returning("global_position")
    .execute();

  if (!inserted || (Array.isArray(inserted) && inserted.length === 0)) {
    return 0n;
  }

  const globalPositions = (inserted as Array<{ global_position: unknown }>).map(
    (r) => BigInt(String((r as { global_position: unknown }).global_position)),
  );
  return globalPositions[globalPositions.length - 1];
}

function parseRangeOptions(
  options?: ReadStreamOptions<bigint> | ProjectionReadStreamOptions,
): {
  from?: bigint;
  to?: bigint;
  maxCount?: bigint;
} {
  const from: bigint | undefined =
    options && typeof options === "object" && "from" in options
      ? options.from
      : undefined;
  const to: bigint | undefined =
    options && typeof options === "object" && "to" in options
      ? options.to
      : undefined;
  const maxCount: bigint | undefined =
    options && typeof options === "object" && "maxCount" in options
      ? options.maxCount
      : undefined;

  return { from, to, maxCount };
}

function buildEventsQuery(
  deps: Dependencies,
  streamId: string,
  partition: string,
  range: { from?: bigint; to?: bigint; maxCount?: bigint },
): {
  execute: () => Promise<
    Array<{
      message_type: string;
      message_data: unknown;
      message_metadata: unknown;
      stream_position: string | number | bigint;
      global_position: string | number | bigint | null;
      message_id: string;
    }>
  >;
} {
  const { db } = deps;
  let q = db
    .selectFrom("messages")
    .select([
      "message_type",
      "message_data",
      "message_metadata",
      "stream_position",
      "global_position",
      "message_id",
    ])
    .where("stream_id", "=", streamId)
    .where("partition", "=", partition)
    .where("is_archived", "=", false)
    .orderBy("stream_position");

  if (range.from !== undefined) {
    q = q.where("stream_position", ">=", range.from);
  }
  if (range.to !== undefined) {
    q = q.where("stream_position", "<=", range.to);
  }
  if (range.maxCount !== undefined) {
    q = q.limit(Number(range.maxCount));
  }

  return q;
}

type SelectedMessageRow = {
  message_type: string;
  message_data: unknown;
  message_metadata: unknown;
  stream_position: string | number | bigint;
  global_position: string | number | bigint | null;
  message_id: string;
};

function mapRowToEvent<EventType extends Event>(
  row: SelectedMessageRow,
  streamId: string,
): ReadEvent<EventType, KyselyReadEventMetadata> {
  const streamPosition = BigInt(String(row.stream_position));
  const globalPosition = BigInt(String(row.global_position ?? 0));
  const baseMetadata = (row.message_metadata ?? {}) as Record<string, unknown>;
  return {
    kind: "Event",
    type: row.message_type,
    data: row.message_data as EventType["data"],
    metadata: {
      ...baseMetadata,
      messageId: row.message_id,
      streamId: streamId,
      streamPosition: streamPosition,
      globalPosition: globalPosition,
    },
  } as ReadEvent<EventType, KyselyReadEventMetadata>;
}

async function fetchStreamInfo(
  executor: Dependencies["db"],
  streamId: string,
  partition: string,
): Promise<{ currentStreamVersion: bigint; streamExists: boolean }> {
  const streamRow = await executor
    .selectFrom("streams")
    .select(["stream_position"])
    .where("stream_id", "=", streamId)
    .where("partition", "=", partition)
    .where("is_archived", "=", false)
    .executeTakeFirst();

  const currentStreamVersion = streamRow
    ? BigInt(String(streamRow.stream_position))
    : PostgreSQLEventStoreDefaultStreamVersion;

  return { currentStreamVersion, streamExists: !!streamRow };
}
