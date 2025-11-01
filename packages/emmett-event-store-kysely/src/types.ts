import type { Kysely } from "kysely";

// Database executor that works with any Kysely database
export type DatabaseExecutor<T = any> = Kysely<T>;

export type Logger = {
  info: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
  warn?: (obj: unknown, msg?: string) => void;
  debug?: (obj: unknown, msg?: string) => void;
};

export type Dependencies<T = any> = {
  db: DatabaseExecutor<T>;
  logger: Logger;
  /** If true, the provided db is already a transaction executor. */
  inTransaction?: boolean;
};

export type ExtendedOptions = {
  partition?: string;
  streamType?: string;
};

export const PostgreSQLEventStoreDefaultStreamVersion = 0n;
export const DEFAULT_PARTITION = "default_partition" as const;

// Projection types
export type ProjectionEventMetadata = {
  streamId: string;
  streamPosition: bigint;
  globalPosition: bigint;
};

/**
 * ProjectionEvent that preserves discriminated union relationships.
 *
 * Instead of independent EventType and EventData generics, this accepts a union type
 * where each variant has a specific type-data pairing. This allows TypeScript to
 * properly narrow the data type when you narrow the event type.
 *
 * @example
 * ```typescript
 * type MyEvent =
 *   | { type: "Created"; data: { id: string } }
 *   | { type: "Updated"; data: { name: string } };
 *
 * type MyProjectionEvent = ProjectionEvent<MyEvent>;
 *
 * function handle(event: MyProjectionEvent) {
 *   if (event.type === "Created") {
 *     // TypeScript knows event.data is { id: string }
 *     console.log(event.data.id);
 *   }
 * }
 * ```
 */
export type ProjectionEvent<E extends { type: string; data: unknown }> = E & {
  metadata: ProjectionEventMetadata;
};

export type ProjectionContext<T = DatabaseExecutor<any>> = {
  db: T;
  partition: string;
};

export type ProjectionHandler<
  T = DatabaseExecutor<any>,
  E extends { type: string; data: unknown } = { type: string; data: unknown },
> = (
  ctx: ProjectionContext<T>,
  event: ProjectionEvent<E>,
) => void | Promise<void>;

/**
 * ProjectionRegistry maps event types to their handlers.
 * The `any` in `ProjectionHandler<T, any>[]` is intentional - it allows handlers
 * for different event types to be registered together, with type safety enforced
 * at the handler level through the ProjectionHandler generic parameter.
 */
export type ProjectionRegistry<T = DatabaseExecutor<any>> = Record<
  string,
  ProjectionHandler<T, { type: string; data: unknown }>[]
>;

export function createProjectionRegistry<T = DatabaseExecutor<any>>(
  ...registries: ProjectionRegistry<T>[]
): ProjectionRegistry<T> {
  const combined: ProjectionRegistry<T> = {};
  /**
   * This is necessary because the projection runner can be used to project events from multiple partitions.
   * e.g., the generators-read-model projection runner can be used to project events for partition A, partition B, and partition C.
   */
  for (const reg of registries) {
    for (const [eventType, handlers] of Object.entries(reg)) {
      combined[eventType] = [...(combined[eventType] ?? []), ...handlers];
    }
  }
  return combined;
}
