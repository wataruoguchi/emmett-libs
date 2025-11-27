export { createKyselyEventStoreConsumer } from "./event-store/consumers.js";
export type {
  KyselyEventStoreConsumer,
  KyselyEventStoreConsumerConfig,
} from "./event-store/consumers.js";
export { getKyselyEventStore } from "./event-store/kysely-event-store.js";
export type {
  KyselyEventStore,
  KyselyEventStoreOptions,
  ProjectionReadStreamOptions,
} from "./event-store/kysely-event-store.js";
export { createProjectionRunner } from "./projections/runner.js";
export type { ProjectEvents } from "./projections/runner.js";
export {
  createSnapshotProjection,
  createSnapshotProjectionRegistry,
} from "./projections/snapshot-projection.js";
export type { SnapshotProjectionConfig } from "./projections/snapshot-projection.js";
export { createProjectionRegistry } from "./types.js";
export type {
  DatabaseExecutor,
  Dependencies,
  ExtendedOptions,
  ProjectionContext,
  ProjectionEvent,
  ProjectionEventMetadata,
  ProjectionHandler,
  ProjectionRegistry,
} from "./types.js";
