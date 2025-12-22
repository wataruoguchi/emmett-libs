import { describe, expect, it, vi } from "vitest";
import { createProjectionRunner } from "../projections/runner.js";
import {
  constructStreamId,
  createSnapshotProjection,
  createSnapshotProjectionRegistry,
  createSnapshotProjectionWithSnapshotTable,
  createSnapshotProjectionRegistryWithSnapshotTable,
  loadStateFromSnapshot,
} from "../projections/snapshot-projection.js";
import type { ProjectionHandler, ProjectionRegistry } from "../types.js";
import { createProjectionRegistry } from "../types.js";

describe("Projections Modules", () => {
  describe("createProjectionRunner", () => {
    it("should create projection runner with projectEvents function", () => {
      const mockDb = {
        selectFrom: vi.fn(),
        insertInto: vi.fn(),
        updateTable: vi.fn(),
        transaction: vi.fn(),
      } as never;

      const mockReadStream = vi.fn();
      const registry: ProjectionRegistry = {};

      const runner = createProjectionRunner({
        db: mockDb,
        readStream: mockReadStream,
        registry,
      });

      expect(typeof runner.projectEvents).toBe("function");
    });

    it("should handle empty projection registry", () => {
      const mockDb = {
        selectFrom: vi.fn(),
        insertInto: vi.fn(),
        updateTable: vi.fn(),
        transaction: vi.fn(),
      } as never;

      const mockReadStream = vi.fn();
      const registry: ProjectionRegistry = {};

      const runner = createProjectionRunner({
        db: mockDb,
        readStream: mockReadStream,
        registry,
      });

      expect(typeof runner.projectEvents).toBe("function");
    });

    it("should handle projection registry with handlers", () => {
      const mockDb = {
        selectFrom: vi.fn(),
        insertInto: vi.fn(),
        updateTable: vi.fn(),
        transaction: vi.fn(),
      } as never;

      const mockReadStream = vi.fn();
      const handler: ProjectionHandler = vi.fn();
      const registry: ProjectionRegistry = {
        EventType1: [handler],
      };

      const runner = createProjectionRunner({
        db: mockDb,
        readStream: mockReadStream,
        registry,
      });

      expect(typeof runner.projectEvents).toBe("function");
    });
  });

  describe("ProjectionRunnerDeps", () => {
    it("should accept correct dependencies structure", () => {
      const mockDb = {
        selectFrom: vi.fn(),
        insertInto: vi.fn(),
        updateTable: vi.fn(),
        transaction: vi.fn(),
      } as never;

      const mockReadStream = vi.fn();
      const registry: ProjectionRegistry = {};

      const deps = {
        db: mockDb,
        readStream: mockReadStream,
        registry,
      };

      expect(deps.db).toBe(mockDb);
      expect(deps.readStream).toBe(mockReadStream);
      expect(deps.registry).toBe(registry);
    });
  });

  describe("ProjectionHandler Integration", () => {
    it("should handle synchronous projection handlers", () => {
      const mockDb = {
        selectFrom: vi.fn(),
        insertInto: vi.fn(),
        updateTable: vi.fn(),
        transaction: vi.fn(),
      } as never;

      const mockReadStream = vi.fn();
      const handler: ProjectionHandler = vi.fn();
      const registry: ProjectionRegistry = {
        EventType1: [handler],
      };

      const runner = createProjectionRunner({
        db: mockDb,
        readStream: mockReadStream,
        registry,
      });

      expect(typeof runner.projectEvents).toBe("function");
    });

    it("should handle asynchronous projection handlers", () => {
      const mockDb = {
        selectFrom: vi.fn(),
        insertInto: vi.fn(),
        updateTable: vi.fn(),
        transaction: vi.fn(),
      } as never;

      const mockReadStream = vi.fn();
      const handler: ProjectionHandler = vi.fn().mockResolvedValue(undefined);
      const registry: ProjectionRegistry = {
        EventType1: [handler],
      };

      const runner = createProjectionRunner({
        db: mockDb,
        readStream: mockReadStream,
        registry,
      });

      expect(typeof runner.projectEvents).toBe("function");
    });

    it("should handle multiple handlers for same event type", () => {
      const mockDb = {
        selectFrom: vi.fn(),
        insertInto: vi.fn(),
        updateTable: vi.fn(),
        transaction: vi.fn(),
      } as never;

      const mockReadStream = vi.fn();
      const handler1: ProjectionHandler = vi.fn();
      const handler2: ProjectionHandler = vi.fn();
      const registry: ProjectionRegistry = {
        EventType1: [handler1, handler2],
      };

      const runner = createProjectionRunner({
        db: mockDb,
        readStream: mockReadStream,
        registry,
      });

      expect(typeof runner.projectEvents).toBe("function");
    });

    it("should handle handlers for different event types", () => {
      const mockDb = {
        selectFrom: vi.fn(),
        insertInto: vi.fn(),
        updateTable: vi.fn(),
        transaction: vi.fn(),
      } as never;

      const mockReadStream = vi.fn();
      const handler1: ProjectionHandler = vi.fn();
      const handler2: ProjectionHandler = vi.fn();
      const registry: ProjectionRegistry = {
        EventType1: [handler1],
        EventType2: [handler2],
      };

      const runner = createProjectionRunner({
        db: mockDb,
        readStream: mockReadStream,
        registry,
      });

      expect(typeof runner.projectEvents).toBe("function");
    });
  });

  describe("createProjectionRegistry Edge Cases", () => {
    it("should handle no arguments", () => {
      const result = createProjectionRegistry();
      expect(result).toEqual({});
    });

    it("should handle single empty registry", () => {
      const result = createProjectionRegistry({});
      expect(result).toEqual({});
    });

    it("should handle multiple empty registries", () => {
      const result = createProjectionRegistry({}, {}, {});
      expect(result).toEqual({});
    });

    it("should handle mixed empty and non-empty registries", () => {
      const handler = vi.fn();
      const result = createProjectionRegistry(
        {},
        { EventType1: [handler] },
        {},
      );
      expect(result).toEqual({ EventType1: [handler] });
    });

    it("should preserve handler order", () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const handler3 = vi.fn();

      const registry1 = { EventType1: [handler1, handler2] };
      const registry2 = { EventType1: [handler3] };

      const result = createProjectionRegistry(registry1, registry2);
      expect(result.EventType1).toEqual([handler1, handler2, handler3]);
    });
  });

  describe("createSnapshotProjection", () => {
    it("should create a snapshot projection handler with inferred primary keys", () => {
      const mockEvolve = vi.fn((_state, _event) => ({ count: 1 }));
      const mockInitialState = vi.fn(() => ({ count: 0 }));

      const handler = createSnapshotProjection({
        tableName: "test_table",
        extractKeys: (_event, _partition) => ({ id: "test-id" }),
        evolve: mockEvolve,
        initialState: mockInitialState,
      });

      expect(typeof handler).toBe("function");
    });

    it("should handle projection config with multiple inferred primary keys", () => {
      const mockEvolve = vi.fn((state, _event) => state);
      const mockInitialState = vi.fn(() => ({}));

      const handler = createSnapshotProjection({
        tableName: "test_table",
        extractKeys: (_event, partition) => ({
          tenant_id: "tenant-1",
          entity_id: "entity-1",
          partition,
        }),
        evolve: mockEvolve,
        initialState: mockInitialState,
      });

      expect(typeof handler).toBe("function");
    });
  });

  describe("createSnapshotProjectionRegistry", () => {
    it("should create registry with multiple event types", () => {
      const mockEvolve = vi.fn((state, _event) => state);
      const mockInitialState = vi.fn(() => ({}));

      const registry = createSnapshotProjectionRegistry(
        ["EventType1", "EventType2", "EventType3"],
        {
          tableName: "test_table",
          extractKeys: (_event, _partition) => ({ id: "test-id" }),
          evolve: mockEvolve,
          initialState: mockInitialState,
        },
      );

      expect(Object.keys(registry)).toEqual([
        "EventType1",
        "EventType2",
        "EventType3",
      ]);
      expect(registry.EventType1).toHaveLength(1);
      expect(registry.EventType2).toHaveLength(1);
      expect(registry.EventType3).toHaveLength(1);
    });

    it("should create registry with empty event types array", () => {
      const mockEvolve = vi.fn((state, _event) => state);
      const mockInitialState = vi.fn(() => ({}));

      const registry = createSnapshotProjectionRegistry([], {
        tableName: "test_table",
        extractKeys: (_event, _partition) => ({ id: "test-id" }),
        evolve: mockEvolve,
        initialState: mockInitialState,
      });

      expect(Object.keys(registry)).toEqual([]);
    });

    it("should share the same handler instance across event types", () => {
      const mockEvolve = vi.fn((state, _event) => state);
      const mockInitialState = vi.fn(() => ({}));

      const registry = createSnapshotProjectionRegistry(
        ["EventType1", "EventType2"],
        {
          tableName: "test_table",
          extractKeys: (_event, _partition) => ({ id: "test-id" }),
          evolve: mockEvolve,
          initialState: mockInitialState,
        },
      );

      // All event types should have the same handler instance
      expect(registry.EventType1[0]).toBe(registry.EventType2[0]);
    });
  });

  describe("Snapshot Projection Integration", () => {
    it("should work with projection runner", async () => {
      const mockEvolve = vi.fn((state, _event) => ({
        ...state,
        processed: true,
      }));
      const mockInitialState = vi.fn(() => ({ processed: false }));

      const registry = createSnapshotProjectionRegistry(["TestEvent"], {
        tableName: "test_table",
        extractKeys: (_event, _partition) => ({ id: "test-id" }),
        evolve: mockEvolve,
        initialState: mockInitialState,
      });

      // Mock transaction execution
      const mockTransactionExecute = vi.fn(async (callback) => {
        // Return a mock transaction object that handlers can use
        const mockTrx = {
          selectFrom: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                forUpdate: vi.fn().mockReturnValue({
                  executeTakeFirst: vi.fn().mockResolvedValue(null),
                }),
              }),
            }),
          }),
          insertInto: vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({
              onConflict: vi.fn().mockReturnValue({
                execute: vi.fn().mockResolvedValue(undefined),
              }),
            }),
          }),
          updateTable: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                  execute: vi.fn().mockResolvedValue(undefined),
                }),
              }),
            }),
          }),
        };
        return await callback(mockTrx);
      });

      const mockTransaction = vi.fn().mockReturnValue({
        execute: mockTransactionExecute,
      });

      // Mock checkpoint read (outside transaction)
      const mockCheckpointSelect = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              executeTakeFirst: vi.fn().mockResolvedValue({
                subscriptionId: "test-sub",
                partition: "default_partition",
                lastProcessedPosition: 0n,
              }),
            }),
          }),
        }),
      });

      const mockDb = {
        selectFrom: vi.fn((table) => {
          if (table === "subscriptions") {
            return mockCheckpointSelect();
          }
          return {
            select: vi.fn(),
            insertInto: vi.fn(),
            updateTable: vi.fn(),
          };
        }),
        insertInto: vi.fn(),
        updateTable: vi.fn(),
        transaction: mockTransaction,
      } as any;

      const mockEvents = [
        {
          type: "TestEvent",
          data: { test: "data" },
          metadata: {
            streamId: "stream-1",
            streamPosition: 1n,
            globalPosition: 1n,
          },
        },
      ];

      const mockReadStream = vi.fn().mockResolvedValue({
        events: mockEvents,
        currentStreamVersion: 1n,
      });

      const runner = createProjectionRunner({
        db: mockDb,
        readStream: mockReadStream,
        registry,
      });

      expect(typeof runner.projectEvents).toBe("function");

      // Execute the projection
      const result = await runner.projectEvents("test-sub", "stream-1", {
        partition: "default_partition",
      });

      // Verify transaction was called
      expect(mockTransaction).toHaveBeenCalled();

      // Verify transaction.execute was called (once per event)
      expect(mockTransactionExecute).toHaveBeenCalledTimes(1);

      // Verify readStream was called with correct parameters
      expect(mockReadStream).toHaveBeenCalledWith("stream-1", {
        from: 1n, // checkpoint (0) + 1
        to: 500n, // checkpoint (0) + batchSize (500)
        partition: "default_partition",
      });

      // Verify result
      expect(result).toEqual({
        processed: 1,
        currentStreamVersion: 1n,
      });
    });

    it("should combine snapshot registries with regular registries", () => {
      const mockEvolve = vi.fn((state, _event) => state);
      const mockInitialState = vi.fn(() => ({}));

      const snapshotRegistry = createSnapshotProjectionRegistry(
        ["SnapshotEvent"],
        {
          tableName: "snapshot_table",
          extractKeys: (_event, _partition) => ({ id: "test-id" }),
          evolve: mockEvolve,
          initialState: mockInitialState,
        },
      );

      const regularHandler: ProjectionHandler = vi.fn();
      const regularRegistry: ProjectionRegistry = {
        RegularEvent: [regularHandler],
      };

      const combined = createProjectionRegistry(
        snapshotRegistry,
        regularRegistry,
      );

      expect(Object.keys(combined)).toContain("SnapshotEvent");
      expect(Object.keys(combined)).toContain("RegularEvent");
      expect(combined.SnapshotEvent).toHaveLength(1);
      expect(combined.RegularEvent).toHaveLength(1);
    });
  });

  describe("mapToColumns feature", () => {
    it("should support optional mapToColumns for denormalization", () => {
      const mockEvolve = vi.fn((_state, _event) => ({
        status: "active",
        items: [{ sku: "SKU-1", quantity: 1 }],
        total: 100,
      }));
      const mockInitialState = vi.fn(() => ({
        status: "init",
        items: [],
        total: 0,
      }));
      const mockMapToColumns = vi.fn((state: any) => ({
        status_text: state.status,
        items_count: state.items.length,
        total_amount: state.total,
      }));

      const handler = createSnapshotProjection({
        tableName: "test_table",
        extractKeys: (_event, _partition) => ({ id: "test-id" }),
        evolve: mockEvolve,
        initialState: mockInitialState,
        mapToColumns: mockMapToColumns,
      });

      expect(typeof handler).toBe("function");
      // The handler should be callable
      expect(handler).toBeDefined();
    });

    it("should work without mapToColumns (backward compatibility)", () => {
      const mockEvolve = vi.fn((_state, _event) => ({ count: 1 }));
      const mockInitialState = vi.fn(() => ({ count: 0 }));

      const handler = createSnapshotProjection({
        tableName: "test_table",
        extractKeys: (_event, _partition) => ({ id: "test-id" }),
        evolve: mockEvolve,
        initialState: mockInitialState,
        // No mapToColumns - should still work
      });

      expect(typeof handler).toBe("function");
    });

    it("should create registry with mapToColumns", () => {
      const mockEvolve = vi.fn((state, _event) => state);
      const mockInitialState = vi.fn(() => ({}));
      const mockMapToColumns = vi.fn((state: any) => ({
        field1: state.value1,
        field2: state.value2,
      }));

      const registry = createSnapshotProjectionRegistry(["Event1", "Event2"], {
        tableName: "test_table",
        extractKeys: (_event, _partition) => ({ id: "test-id" }),
        evolve: mockEvolve,
        initialState: mockInitialState,
        mapToColumns: mockMapToColumns,
      });

      expect(Object.keys(registry)).toEqual(["Event1", "Event2"]);
      expect(registry.Event1).toHaveLength(1);
      expect(registry.Event2).toHaveLength(1);
    });

    it("should call mapToColumns exactly once on update event (not create)", async () => {
      const existingState = { count: 5, status: "active" };
      const newState = { count: 6, status: "active" };
      const mockEvolve = vi.fn((_state, _event) => newState);
      const mockInitialState = vi.fn(() => ({ count: 0, status: "init" }));
      const mockMapToColumns = vi.fn((state: any) => ({
        count_value: state.count,
        status_text: state.status,
      }));

      const handler = createSnapshotProjection({
        tableName: "test_table",
        extractKeys: (_event, _partition) => ({ id: "test-id" }),
        evolve: mockEvolve,
        initialState: mockInitialState,
        mapToColumns: mockMapToColumns,
      });

      // Mock database that returns an existing row (update scenario, not create)
      const mockDb = {
        selectFrom: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              forUpdate: vi.fn().mockReturnValue({
                executeTakeFirst: vi.fn().mockResolvedValue({
                  last_stream_position: "1",
                  snapshot: JSON.stringify(existingState),
                }),
              }),
            }),
          }),
        }),
        insertInto: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            onConflict: vi.fn().mockReturnValue({
              execute: vi.fn().mockResolvedValue(undefined),
            }),
          }),
        }),
      } as any;

      const event = {
        type: "TestEvent",
        data: {},
        metadata: {
          streamId: "stream-1",
          streamPosition: 2n, // Newer than existing position 1
          globalPosition: 2n,
        },
      };

      await handler({ db: mockDb, partition: "partition-1" }, event);

      // Verify mapToColumns was called exactly once with the new state
      expect(mockMapToColumns).toHaveBeenCalledTimes(1);
      expect(mockMapToColumns).toHaveBeenCalledWith(newState);
      expect(mockEvolve).toHaveBeenCalledWith(existingState, event);
    });
  });

  describe("createSnapshotProjectionWithSnapshotTable", () => {
    it("should create a snapshot projection handler with inferred primary keys", () => {
      const mockEvolve = vi.fn((_state, _event) => ({ count: 1 }));
      const mockInitialState = vi.fn(() => ({ count: 0 }));

      const handler = createSnapshotProjectionWithSnapshotTable({
        tableName: "test_table",
        extractKeys: (_event, _partition) => ({ id: "test-id" }),
        evolve: mockEvolve,
        initialState: mockInitialState,
      });

      expect(typeof handler).toBe("function");
    });

    it("should handle projection config with multiple inferred primary keys", () => {
      const mockEvolve = vi.fn((state, _event) => state);
      const mockInitialState = vi.fn(() => ({}));

      const handler = createSnapshotProjectionWithSnapshotTable({
        tableName: "test_table",
        extractKeys: (_event, partition) => ({
          tenant_id: "tenant-1",
          entity_id: "entity-1",
          partition,
        }),
        evolve: mockEvolve,
        initialState: mockInitialState,
      });

      expect(typeof handler).toBe("function");
    });
  });

  describe("createSnapshotProjectionRegistryWithSnapshotTable", () => {
    it("should create registry with multiple event types", () => {
      const mockEvolve = vi.fn((state, _event) => state);
      const mockInitialState = vi.fn(() => ({}));

      const registry = createSnapshotProjectionRegistryWithSnapshotTable(
        ["EventType1", "EventType2", "EventType3"],
        {
          tableName: "test_table",
          extractKeys: (_event, _partition) => ({ id: "test-id" }),
          evolve: mockEvolve,
          initialState: mockInitialState,
        },
      );

      expect(Object.keys(registry)).toEqual([
        "EventType1",
        "EventType2",
        "EventType3",
      ]);
      expect(registry.EventType1).toHaveLength(1);
      expect(registry.EventType2).toHaveLength(1);
      expect(registry.EventType3).toHaveLength(1);
    });

    it("should create registry with empty event types array", () => {
      const mockEvolve = vi.fn((state, _event) => state);
      const mockInitialState = vi.fn(() => ({}));

      const registry = createSnapshotProjectionRegistryWithSnapshotTable([], {
        tableName: "test_table",
        extractKeys: (_event, _partition) => ({ id: "test-id" }),
        evolve: mockEvolve,
        initialState: mockInitialState,
      });

      expect(Object.keys(registry)).toEqual([]);
    });

    it("should share the same handler instance across event types", () => {
      const mockEvolve = vi.fn((state, _event) => state);
      const mockInitialState = vi.fn(() => ({}));

      const registry = createSnapshotProjectionRegistryWithSnapshotTable(
        ["EventType1", "EventType2"],
        {
          tableName: "test_table",
          extractKeys: (_event, _partition) => ({ id: "test-id" }),
          evolve: mockEvolve,
          initialState: mockInitialState,
        },
      );

      // All event types should have the same handler instance
      expect(registry.EventType1[0]).toBe(registry.EventType2[0]);
    });
  });

  describe("Snapshot Projection With Snapshot Table Integration", () => {
    it("should work with projection runner", async () => {
      const mockEvolve = vi.fn((state, _event) => ({
        ...state,
        processed: true,
      }));
      const mockInitialState = vi.fn(() => ({ processed: false }));

      const registry = createSnapshotProjectionRegistryWithSnapshotTable(
        ["TestEvent"],
        {
          tableName: "test_table",
          extractKeys: (_event, _partition) => ({ id: "test-id" }),
          evolve: mockEvolve,
          initialState: mockInitialState,
        },
      );

      // Mock transaction execution
      const mockTransactionExecute = vi.fn(async (callback) => {
        // Return a mock transaction object that handlers can use
        const mockWhereChain = {
          where: vi.fn().mockReturnThis(),
          forUpdate: vi.fn().mockReturnValue({
            executeTakeFirst: vi.fn().mockResolvedValue(null),
          }),
        };

        const mockTrx = {
          selectFrom: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue(mockWhereChain),
          }),
          insertInto: vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({
              onConflict: vi.fn().mockReturnValue({
                execute: vi.fn().mockResolvedValue(undefined),
                doNothing: vi.fn().mockReturnValue({
                  execute: vi.fn().mockResolvedValue(undefined),
                }),
              }),
            }),
          }),
          updateTable: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                  execute: vi.fn().mockResolvedValue(undefined),
                }),
              }),
            }),
          }),
        };
        return await callback(mockTrx);
      });

      const mockTransaction = vi.fn().mockReturnValue({
        execute: mockTransactionExecute,
      });

      // Mock checkpoint read (outside transaction)
      const mockCheckpointSelect = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              executeTakeFirst: vi.fn().mockResolvedValue({
                subscriptionId: "test-sub",
                partition: "default_partition",
                lastProcessedPosition: 0n,
              }),
            }),
          }),
        }),
      });

      const mockDb = {
        selectFrom: vi.fn((table) => {
          if (table === "subscriptions") {
            return mockCheckpointSelect();
          }
          return {
            select: vi.fn(),
            insertInto: vi.fn(),
            updateTable: vi.fn(),
          };
        }),
        insertInto: vi.fn(),
        updateTable: vi.fn(),
        transaction: mockTransaction,
      } as any;

      const mockEvents = [
        {
          type: "TestEvent",
          data: { test: "data" },
          metadata: {
            streamId: "stream-1",
            streamPosition: 1n,
            globalPosition: 1n,
          },
        },
      ];

      const mockReadStream = vi.fn().mockResolvedValue({
        events: mockEvents,
        currentStreamVersion: 1n,
      });

      const runner = createProjectionRunner({
        db: mockDb,
        readStream: mockReadStream,
        registry,
      });

      expect(typeof runner.projectEvents).toBe("function");

      // Execute the projection
      const result = await runner.projectEvents("test-sub", "stream-1", {
        partition: "default_partition",
      });

      // Verify transaction was called
      expect(mockTransaction).toHaveBeenCalled();

      // Verify transaction.execute was called (once per event)
      expect(mockTransactionExecute).toHaveBeenCalledTimes(1);

      // Verify readStream was called with correct parameters
      expect(mockReadStream).toHaveBeenCalledWith("stream-1", {
        from: 1n, // checkpoint (0) + 1
        to: 500n, // checkpoint (0) + batchSize (500)
        partition: "default_partition",
      });

      // Verify result
      expect(result).toEqual({
        processed: 1,
        currentStreamVersion: 1n,
      });
    });

    it("should combine snapshot table registries with regular registries", () => {
      const mockEvolve = vi.fn((state, _event) => state);
      const mockInitialState = vi.fn(() => ({}));

      const snapshotTableRegistry =
        createSnapshotProjectionRegistryWithSnapshotTable(
          ["SnapshotTableEvent"],
          {
            tableName: "snapshot_table",
            extractKeys: (_event, _partition) => ({ id: "test-id" }),
            evolve: mockEvolve,
            initialState: mockInitialState,
          },
        );

      const regularHandler: ProjectionHandler = vi.fn();
      const regularRegistry: ProjectionRegistry = {
        RegularEvent: [regularHandler],
      };

      const combined = createProjectionRegistry(
        snapshotTableRegistry,
        regularRegistry,
      );

      expect(Object.keys(combined)).toContain("SnapshotTableEvent");
      expect(Object.keys(combined)).toContain("RegularEvent");
      expect(combined.SnapshotTableEvent).toHaveLength(1);
      expect(combined.RegularEvent).toHaveLength(1);
    });

    it("should combine snapshot table registries with legacy snapshot registries", () => {
      const mockEvolve = vi.fn((state, _event) => state);
      const mockInitialState = vi.fn(() => ({}));

      const snapshotTableRegistry =
        createSnapshotProjectionRegistryWithSnapshotTable(
          ["SnapshotTableEvent"],
          {
            tableName: "snapshot_table",
            extractKeys: (_event, _partition) => ({ id: "test-id" }),
            evolve: mockEvolve,
            initialState: mockInitialState,
          },
        );

      const legacySnapshotRegistry = createSnapshotProjectionRegistry(
        ["LegacySnapshotEvent"],
        {
          tableName: "legacy_table",
          extractKeys: (_event, _partition) => ({ id: "test-id" }),
          evolve: mockEvolve,
          initialState: mockInitialState,
        },
      );

      const combined = createProjectionRegistry(
        snapshotTableRegistry,
        legacySnapshotRegistry,
      );

      expect(Object.keys(combined)).toContain("SnapshotTableEvent");
      expect(Object.keys(combined)).toContain("LegacySnapshotEvent");
      expect(combined.SnapshotTableEvent).toHaveLength(1);
      expect(combined.LegacySnapshotEvent).toHaveLength(1);
    });
  });

  describe("mapToColumns feature with snapshot table", () => {
    it("should support optional mapToColumns for denormalization", () => {
      const mockEvolve = vi.fn((_state, _event) => ({
        status: "active",
        items: [{ sku: "SKU-1", quantity: 1 }],
        total: 100,
      }));
      const mockInitialState = vi.fn(() => ({
        status: "init",
        items: [],
        total: 0,
      }));
      const mockMapToColumns = vi.fn((state: any) => ({
        status_text: state.status,
        items_count: state.items.length,
        total_amount: state.total,
      }));

      const handler = createSnapshotProjectionWithSnapshotTable({
        tableName: "test_table",
        extractKeys: (_event, _partition) => ({ id: "test-id" }),
        evolve: mockEvolve,
        initialState: mockInitialState,
        mapToColumns: mockMapToColumns,
      });

      expect(typeof handler).toBe("function");
      // The handler should be callable
      expect(handler).toBeDefined();
    });

    it("should work without mapToColumns (backward compatibility)", () => {
      const mockEvolve = vi.fn((_state, _event) => ({ count: 1 }));
      const mockInitialState = vi.fn(() => ({ count: 0 }));

      const handler = createSnapshotProjectionWithSnapshotTable({
        tableName: "test_table",
        extractKeys: (_event, _partition) => ({ id: "test-id" }),
        evolve: mockEvolve,
        initialState: mockInitialState,
        // No mapToColumns - should still work
      });

      expect(typeof handler).toBe("function");
    });

    it("should create registry with mapToColumns", () => {
      const mockEvolve = vi.fn((state, _event) => state);
      const mockInitialState = vi.fn(() => ({}));
      const mockMapToColumns = vi.fn((state: any) => ({
        field1: state.value1,
        field2: state.value2,
      }));

      const registry = createSnapshotProjectionRegistryWithSnapshotTable(
        ["Event1", "Event2"],
        {
          tableName: "test_table",
          extractKeys: (_event, _partition) => ({ id: "test-id" }),
          evolve: mockEvolve,
          initialState: mockInitialState,
          mapToColumns: mockMapToColumns,
        },
      );

      expect(Object.keys(registry)).toEqual(["Event1", "Event2"]);
      expect(registry.Event1).toHaveLength(1);
      expect(registry.Event2).toHaveLength(1);
    });

    it("should call mapToColumns exactly once on update event (not create)", async () => {
      const existingState = { count: 5, status: "active" };
      const newState = { count: 6, status: "active" };
      const mockEvolve = vi.fn((_state, _event) => newState);
      const mockInitialState = vi.fn(() => ({ count: 0, status: "init" }));
      const mockMapToColumns = vi.fn((state: any) => ({
        count_value: state.count,
        status_text: state.status,
      }));

      const handler = createSnapshotProjectionWithSnapshotTable({
        tableName: "test_table",
        extractKeys: (_event, _partition) => ({ id: "test-id" }),
        evolve: mockEvolve,
        initialState: mockInitialState,
        mapToColumns: mockMapToColumns,
      });

      // Create a chainable mock that supports multiple .where() calls
      const mockWhereChain = {
        where: vi.fn().mockReturnThis(),
        forUpdate: vi.fn().mockReturnValue({
          executeTakeFirst: vi.fn().mockResolvedValue({
            last_stream_position: "1",
            snapshot: JSON.stringify(existingState),
          }),
        }),
      };

      const mockDoUpdateSet = {
        execute: vi.fn().mockResolvedValue(undefined),
      };

      const mockConflictBuilderForDoUpdateSet = {
        doUpdateSet: vi.fn().mockReturnValue(mockDoUpdateSet),
      };

      const mockOnConflictBuilder = {
        columns: vi.fn().mockReturnValue(mockConflictBuilderForDoUpdateSet),
      };

      const mockReadModelInsert = {
        values: vi.fn().mockReturnValue({
          onConflict: vi.fn((callback) => {
            const result = callback(mockOnConflictBuilder);
            return result;
          }),
        }),
      };

      // Mock database that returns an existing row (update scenario, not create)
      const mockDb = {
        selectFrom: vi.fn((table) => {
          if (table === "snapshots") {
            return {
              select: vi.fn().mockReturnValue(mockWhereChain),
            };
          }
          return {
            select: vi.fn().mockReturnValue(mockWhereChain),
          };
        }),
        insertInto: vi.fn((table) => {
          if (table === "snapshots") {
            return {
              values: vi.fn().mockReturnValue({
                onConflict: vi.fn().mockReturnValue({
                  execute: vi.fn().mockResolvedValue(undefined),
                }),
              }),
            };
          }
          // For read model table
          return mockReadModelInsert;
        }),
      } as any;

      const event = {
        type: "TestEvent",
        data: {},
        metadata: {
          streamId: "stream-1",
          streamPosition: 2n, // Newer than existing position 1
          globalPosition: 2n,
        },
      };

      await handler({ db: mockDb, partition: "partition-1" }, event);

      // Verify mapToColumns was called exactly once with the new state
      expect(mockMapToColumns).toHaveBeenCalledTimes(1);
      expect(mockMapToColumns).toHaveBeenCalledWith(newState);
      expect(mockEvolve).toHaveBeenCalledWith(existingState, event);
    });
  });

  describe("createSnapshotProjection Edge Cases", () => {
    it("should throw error when extractKeys returns inconsistent primary keys", async () => {
      const mockEvolve = vi.fn((state, _event) => state);
      const mockInitialState = vi.fn(() => ({}));

      // Create a handler that will be called twice with different keys
      // First call establishes the key set, second call with different keys should fail
      let callCount = 0;
      const handler = createSnapshotProjection({
        tableName: "test_table",
        extractKeys: (_event, _partition): Record<string, string> => {
          callCount++;
          if (callCount === 1) {
            return { id: "test-id" };
          }
          // Second call returns different keys - should throw
          return {
            id: "test-id",
            tenant_id: "tenant-1", // Different keys
          };
        },
        evolve: mockEvolve,
        initialState: mockInitialState,
      });

      const mockDb = {
        selectFrom: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              forUpdate: vi.fn().mockReturnValue({
                executeTakeFirst: vi.fn().mockResolvedValue(null),
              }),
            }),
          }),
        }),
        insertInto: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            onConflict: vi.fn().mockReturnValue({
              execute: vi.fn().mockResolvedValue(undefined),
            }),
          }),
        }),
      } as any;

      const event1 = {
        type: "TestEvent",
        data: {},
        metadata: {
          streamId: "stream-1",
          streamPosition: 1n,
          globalPosition: 1n,
        },
      };

      const event2 = {
        type: "TestEvent2",
        data: {},
        metadata: {
          streamId: "stream-2",
          streamPosition: 2n,
          globalPosition: 2n,
        },
      };

      // First call should succeed
      await handler({ db: mockDb, partition: "partition-1" }, event1);

      // Second call with different keys should throw
      await expect(
        handler({ db: mockDb, partition: "partition-1" }, event2),
      ).rejects.toThrow(/inconsistent primary keys/);
    });

    it("should skip events with position <= last processed position", async () => {
      const mockEvolve = vi.fn((state, _event) => state);
      const mockInitialState = vi.fn(() => ({}));

      const handler = createSnapshotProjection({
        tableName: "test_table",
        extractKeys: (_event, _partition) => ({ id: "test-id" }),
        evolve: mockEvolve,
        initialState: mockInitialState,
      });

      const mockDb = {
        selectFrom: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              forUpdate: vi.fn().mockReturnValue({
                executeTakeFirst: vi.fn().mockResolvedValue({
                  last_stream_position: "5",
                  snapshot: JSON.stringify({ count: 10 }),
                }),
              }),
            }),
          }),
        }),
        insertInto: vi.fn(),
      } as any;

      const event = {
        type: "TestEvent",
        data: {},
        metadata: {
          streamId: "stream-1",
          streamPosition: 3n, // Older than 5
          globalPosition: 3n,
        },
      };

      await handler({ db: mockDb, partition: "partition-1" }, event);

      // Should not call insertInto since event is skipped
      expect(mockDb.insertInto).not.toHaveBeenCalled();
    });

    it("should handle snapshot as string (JSONB from some drivers)", async () => {
      const mockEvolve = vi.fn((state, _event) => ({
        ...state,
        processed: true,
      }));
      const mockInitialState = vi.fn(() => ({ processed: false }));

      const handler = createSnapshotProjection({
        tableName: "test_table",
        extractKeys: (_event, _partition) => ({ id: "test-id" }),
        evolve: mockEvolve,
        initialState: mockInitialState,
      });

      const mockDb = {
        selectFrom: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              forUpdate: vi.fn().mockReturnValue({
                executeTakeFirst: vi.fn().mockResolvedValue({
                  last_stream_position: "1",
                  snapshot: JSON.stringify({ processed: false }), // String format
                }),
              }),
            }),
          }),
        }),
        insertInto: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            onConflict: vi.fn().mockReturnValue({
              execute: vi.fn().mockResolvedValue(undefined),
            }),
          }),
        }),
      } as never;

      const event = {
        type: "TestEvent",
        data: {},
        metadata: {
          streamId: "stream-1",
          streamPosition: 2n,
          globalPosition: 2n,
        },
      };

      await handler({ db: mockDb, partition: "partition-1" }, event);

      // Should parse string snapshot and evolve it
      expect(mockEvolve).toHaveBeenCalledWith(
        { processed: false },
        expect.objectContaining({ type: "TestEvent" }),
      );
    });

    it("should handle snapshot as parsed JSON object", async () => {
      const mockEvolve = vi.fn((state, _event) => ({
        ...state,
        processed: true,
      }));
      const mockInitialState = vi.fn(() => ({ processed: false }));

      const handler = createSnapshotProjection({
        tableName: "test_table",
        extractKeys: (_event, _partition) => ({ id: "test-id" }),
        evolve: mockEvolve,
        initialState: mockInitialState,
      });

      const mockDb = {
        selectFrom: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              forUpdate: vi.fn().mockReturnValue({
                executeTakeFirst: vi.fn().mockResolvedValue({
                  last_stream_position: "1",
                  snapshot: { processed: false }, // Parsed object
                }),
              }),
            }),
          }),
        }),
        insertInto: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            onConflict: vi.fn().mockReturnValue({
              execute: vi.fn().mockResolvedValue(undefined),
            }),
          }),
        }),
      } as never;

      const event = {
        type: "TestEvent",
        data: {},
        metadata: {
          streamId: "stream-1",
          streamPosition: 2n,
          globalPosition: 2n,
        },
      };

      await handler({ db: mockDb, partition: "partition-1" }, event);

      // Should use parsed object directly
      expect(mockEvolve).toHaveBeenCalledWith(
        { processed: false },
        expect.objectContaining({ type: "TestEvent" }),
      );
    });

    it("should handle empty mapToColumns result", () => {
      const mockEvolve = vi.fn((state, _event) => state);
      const mockInitialState = vi.fn(() => ({}));
      const mockMapToColumns = vi.fn(() => ({})); // Empty object

      const handler = createSnapshotProjection({
        tableName: "test_table",
        extractKeys: (_event, _partition) => ({ id: "test-id" }),
        evolve: mockEvolve,
        initialState: mockInitialState,
        mapToColumns: mockMapToColumns,
      });

      expect(typeof handler).toBe("function");
    });

    it("should handle mapToColumns with null/undefined values", () => {
      const mockEvolve = vi.fn((state, _event) => state);
      const mockInitialState = vi.fn(() => ({}));
      const mockMapToColumns = vi.fn(() => ({
        field1: "value",
        field2: null,
        field3: undefined,
      }));

      const handler = createSnapshotProjection({
        tableName: "test_table",
        extractKeys: (_event, _partition) => ({ id: "test-id" }),
        evolve: mockEvolve,
        initialState: mockInitialState,
        mapToColumns: mockMapToColumns,
      });

      expect(typeof handler).toBe("function");
    });

    it("should handle events with same position (idempotency check)", async () => {
      const mockEvolve = vi.fn((state, _event) => state);
      const mockInitialState = vi.fn(() => ({}));

      const handler = createSnapshotProjection({
        tableName: "test_table",
        extractKeys: (_event, _partition) => ({ id: "test-id" }),
        evolve: mockEvolve,
        initialState: mockInitialState,
      });

      const mockDb = {
        selectFrom: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              forUpdate: vi.fn().mockReturnValue({
                executeTakeFirst: vi.fn().mockResolvedValue({
                  last_stream_position: "5",
                  snapshot: JSON.stringify({}),
                }),
              }),
            }),
          }),
        }),
        insertInto: vi.fn(),
      } as any;

      const event = {
        type: "TestEvent",
        data: {},
        metadata: {
          streamId: "stream-1",
          streamPosition: 5n, // Same as last processed
          globalPosition: 5n,
        },
      };

      await handler({ db: mockDb, partition: "partition-1" }, event);

      // Should skip since position is equal
      expect(mockDb.insertInto).not.toHaveBeenCalled();
    });

    it("should handle special characters in keys for stream_id construction", async () => {
      const mockEvolve = vi.fn((state, _event) => state);
      const mockInitialState = vi.fn(() => ({}));

      const handler = createSnapshotProjectionWithSnapshotTable({
        tableName: "test_table",
        extractKeys: (_event, _partition) => ({
          id: "test|id:with|special:chars",
          tenant_id: "tenant|123",
        }),
        evolve: mockEvolve,
        initialState: mockInitialState,
      });

      // Track the stream_id values used in database operations
      let streamIdInWhere: string | undefined;
      let streamIdInInsert: string | undefined;

      // Create a chainable mock that supports multiple .where() calls
      const mockWhereChain: {
        where: ReturnType<typeof vi.fn>;
        forUpdate: ReturnType<typeof vi.fn>;
      } = {
        where: vi.fn((column, operator, value) => {
          if (column === "stream_id" && operator === "=") {
            streamIdInWhere = value as string;
          }
          return mockWhereChain;
        }),
        forUpdate: vi.fn().mockReturnValue({
          executeTakeFirst: vi.fn().mockResolvedValue(null),
        }),
      };

      const mockDoNothing = {
        execute: vi.fn().mockResolvedValue(undefined),
      };

      const mockConflictBuilderForDoNothing = {
        doNothing: vi.fn().mockReturnValue(mockDoNothing),
      };

      const mockOnConflictBuilderForDoNothing = {
        columns: vi.fn().mockReturnValue(mockConflictBuilderForDoNothing),
      };

      const mockDb = {
        selectFrom: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue(mockWhereChain),
        }),
        insertInto: vi.fn((table) => {
          if (table === "snapshots") {
            return {
              values: vi.fn((values) => {
                streamIdInInsert = values.stream_id as string;
                return {
                  onConflict: vi.fn().mockReturnValue({
                    execute: vi.fn().mockResolvedValue(undefined),
                  }),
                };
              }),
            };
          }
          // For read model table
          return {
            values: vi.fn().mockReturnValue({
              onConflict: vi.fn((callback) => {
                // Call the callback with the mock conflict builder and return its result
                const result = callback(mockOnConflictBuilderForDoNothing);
                return result;
              }),
            }),
          };
        }),
      } as any;

      const event = {
        type: "TestEvent",
        data: {},
        metadata: {
          streamId: "stream-1",
          streamPosition: 1n,
          globalPosition: 1n,
        },
      };

      await handler({ db: mockDb, partition: "partition-1" }, event);

      // Verify stream_id was captured
      expect(streamIdInWhere).toBeDefined();
      expect(streamIdInInsert).toBeDefined();
      expect(streamIdInWhere).toBe(streamIdInInsert); // Should be the same value

      // TypeScript guard - we know it's defined from the assertions above
      if (!streamIdInWhere || !streamIdInInsert) {
        throw new Error("stream_id was not captured");
      }

      // Verify special characters WITHIN keys/values are URL-encoded
      // The delimiter `|` between entries is expected and should be present
      expect(streamIdInWhere).toContain("|"); // Delimiter between entries
      // But the `|` and `:` characters WITHIN the key/value strings should be encoded
      // The raw values "test|id:with|special:chars" and "tenant|123" should not appear
      expect(streamIdInWhere).not.toContain("test|id:with|special:chars");
      expect(streamIdInWhere).not.toContain("tenant|123");
      // Verify encoded versions are present
      expect(streamIdInWhere).toContain(encodeURIComponent("|")); // Encoded pipe
      expect(streamIdInWhere).toContain(encodeURIComponent(":")); // Encoded colon

      // Verify the stream_id format: encodedKey:encodedValue|encodedKey:encodedValue
      // Keys should be sorted alphabetically: id comes before tenant_id
      const parts = streamIdInWhere.split("|");
      expect(parts.length).toBe(2);
      // First part should be id (alphabetically first)
      expect(parts[0]).toContain(encodeURIComponent("id"));
      expect(parts[0]).toContain(
        encodeURIComponent("test|id:with|special:chars"),
      );
      // Second part should be tenant_id
      expect(parts[1]).toContain(encodeURIComponent("tenant_id"));
      expect(parts[1]).toContain(encodeURIComponent("tenant|123"));

      // Verify the exact encoded format
      const expectedStreamId = constructStreamId({
        id: "test|id:with|special:chars",
        tenant_id: "tenant|123",
      });
      expect(streamIdInWhere).toBe(expectedStreamId);
      expect(streamIdInInsert).toBe(expectedStreamId);
    });

    it("should handle empty keys object", () => {
      const mockEvolve = vi.fn((state, _event) => state);
      const mockInitialState = vi.fn(() => ({}));

      const handler = createSnapshotProjection({
        tableName: "test_table",
        extractKeys: (_event, _partition) => ({}), // Empty keys
        evolve: mockEvolve,
        initialState: mockInitialState,
      });

      expect(typeof handler).toBe("function");
    });

    it("should handle very large position values", async () => {
      const mockEvolve = vi.fn((state, _event) => state);
      const mockInitialState = vi.fn(() => ({}));

      const handler = createSnapshotProjection({
        tableName: "test_table",
        extractKeys: (_event, _partition) => ({ id: "test-id" }),
        evolve: mockEvolve,
        initialState: mockInitialState,
      });

      const largePosition = BigInt("999999999999999999999");

      const mockDb = {
        selectFrom: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              forUpdate: vi.fn().mockReturnValue({
                executeTakeFirst: vi.fn().mockResolvedValue({
                  last_stream_position: largePosition.toString(),
                  snapshot: JSON.stringify({}),
                }),
              }),
            }),
          }),
        }),
        insertInto: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            onConflict: vi.fn().mockReturnValue({
              execute: vi.fn().mockResolvedValue(undefined),
            }),
          }),
        }),
      } as any;

      const event = {
        type: "TestEvent",
        data: {},
        metadata: {
          streamId: "stream-1",
          streamPosition: largePosition + 1n,
          globalPosition: largePosition + 1n,
        },
      };

      await handler({ db: mockDb, partition: "partition-1" }, event);

      // Should handle large positions correctly
      expect(mockDb.insertInto).toHaveBeenCalled();
    });
  });

  describe("createSnapshotProjectionWithSnapshotTable Edge Cases", () => {
    it("should throw error when extractKeys returns inconsistent primary keys", async () => {
      const mockEvolve = vi.fn((state, _event) => state);
      const mockInitialState = vi.fn(() => ({}));

      // Create a handler that will be called twice with different keys
      // First call establishes the key set, second call with different keys should fail
      let callCount = 0;
      const handler = createSnapshotProjectionWithSnapshotTable({
        tableName: "test_table",
        extractKeys: (_event, _partition): Record<string, string> => {
          callCount++;
          if (callCount === 1) {
            return { id: "test-id" };
          }
          // Second call returns different keys - should throw
          return {
            id: "test-id",
            tenant_id: "tenant-1", // Different keys
          };
        },
        evolve: mockEvolve,
        initialState: mockInitialState,
      });

      // Create a chainable mock that supports multiple .where() calls
      const mockWhereChain = {
        where: vi.fn().mockReturnThis(),
        forUpdate: vi.fn().mockReturnValue({
          executeTakeFirst: vi.fn().mockResolvedValue(null),
        }),
      };

      const mockDb = {
        selectFrom: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue(mockWhereChain),
        }),
        insertInto: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            onConflict: vi.fn().mockReturnValue({
              execute: vi.fn().mockResolvedValue(undefined),
            }),
          }),
        }),
      } as any;

      const event1 = {
        type: "TestEvent",
        data: {},
        metadata: {
          streamId: "stream-1",
          streamPosition: 1n,
          globalPosition: 1n,
        },
      };

      const event2 = {
        type: "TestEvent2",
        data: {},
        metadata: {
          streamId: "stream-2",
          streamPosition: 2n,
          globalPosition: 2n,
        },
      };

      // First call should succeed
      await handler({ db: mockDb, partition: "partition-1" }, event1);

      // Second call with different keys should throw
      await expect(
        handler({ db: mockDb, partition: "partition-1" }, event2),
      ).rejects.toThrow(/inconsistent primary keys/);
    });

    it("should construct deterministic stream_id from keys", async () => {
      const mockEvolve = vi.fn((state, _event) => state);
      const mockInitialState = vi.fn(() => ({}));

      const handler = createSnapshotProjectionWithSnapshotTable({
        tableName: "test_table",
        extractKeys: (_event, _partition) => ({
          tenant_id: "tenant-1",
          cart_id: "cart-1",
          partition: "partition-1",
        }),
        evolve: mockEvolve,
        initialState: mockInitialState,
      });

      // Create a chainable mock that supports multiple .where() calls
      const mockWhereChain = {
        where: vi.fn().mockReturnThis(),
        forUpdate: vi.fn().mockReturnValue({
          executeTakeFirst: vi.fn().mockResolvedValue(null),
        }),
      };

      const mockDb = {
        selectFrom: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue(mockWhereChain),
        }),
        insertInto: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            onConflict: vi.fn().mockReturnValue({
              execute: vi.fn().mockResolvedValue(undefined),
            }),
          }),
        }),
      } as any;

      const event = {
        type: "TestEvent",
        data: {},
        metadata: {
          streamId: "stream-1",
          streamPosition: 1n,
          globalPosition: 1n,
        },
      };

      await handler({ db: mockDb, partition: "partition-1" }, event);

      // Should construct stream_id from keys, not use event.metadata.streamId
      expect(mockDb.insertInto).toHaveBeenCalled();
      const insertCall = mockDb.insertInto.mock.calls[0];
      expect(insertCall[0]).toBe("snapshots");
    });

    it("should handle read model upsert without denormalized columns", async () => {
      const mockEvolve = vi.fn((state, _event) => state);
      const mockInitialState = vi.fn(() => ({}));

      const handler = createSnapshotProjectionWithSnapshotTable({
        tableName: "test_table",
        extractKeys: (_event, _partition) => ({ id: "test-id" }),
        evolve: mockEvolve,
        initialState: mockInitialState,
        // No mapToColumns
      });

      const mockDoNothing = {
        execute: vi.fn().mockResolvedValue(undefined),
      };

      const mockConflictBuilderForDoNothing = {
        doNothing: vi.fn().mockReturnValue(mockDoNothing),
      };

      const mockOnConflictBuilderForDoNothing = {
        columns: vi.fn().mockReturnValue(mockConflictBuilderForDoNothing),
      };

      const mockReadModelInsert = {
        values: vi.fn().mockReturnValue({
          onConflict: vi.fn((callback) => {
            // Call the callback with the mock conflict builder and return its result
            const result = callback(mockOnConflictBuilderForDoNothing);
            return result;
          }),
        }),
      };

      // Create a chainable mock that supports multiple .where() calls
      const mockWhereChain = {
        where: vi.fn().mockReturnThis(),
        forUpdate: vi.fn().mockReturnValue({
          executeTakeFirst: vi.fn().mockResolvedValue(null),
        }),
      };

      const mockDb = {
        selectFrom: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue(mockWhereChain),
        }),
        insertInto: vi.fn((table) => {
          if (table === "snapshots") {
            return {
              values: vi.fn().mockReturnValue({
                onConflict: vi.fn().mockReturnValue({
                  execute: vi.fn().mockResolvedValue(undefined),
                }),
              }),
            };
          }
          return mockReadModelInsert;
        }),
      } as any;

      const event = {
        type: "TestEvent",
        data: {},
        metadata: {
          streamId: "stream-1",
          streamPosition: 1n,
          globalPosition: 1n,
        },
      };

      await handler({ db: mockDb, partition: "partition-1" }, event);

      // Should use doNothing() when no denormalized columns
      expect(mockDb.insertInto).toHaveBeenCalledWith("test_table");
      expect(mockReadModelInsert.values).toHaveBeenCalled();

      // Verify the actual values passed to the insert query
      const valuesCall = mockReadModelInsert.values.mock.calls[0];
      expect(valuesCall).toBeDefined();
      expect(valuesCall[0]).toEqual({
        id: "test-id",
      });
      // Should only contain keys, no denormalized columns
      expect(Object.keys(valuesCall[0])).toEqual(["id"]);
    });

    it("should handle read model upsert with denormalized columns", async () => {
      const mockEvolve = vi.fn((state, _event) => ({
        ...state,
        status: "active",
      }));
      const mockInitialState = vi.fn(() => ({ status: "init" }));
      const mockMapToColumns = vi.fn((state: any) => ({
        status_text: state.status,
      }));

      const handler = createSnapshotProjectionWithSnapshotTable({
        tableName: "test_table",
        extractKeys: (_event, _partition) => ({ id: "test-id" }),
        evolve: mockEvolve,
        initialState: mockInitialState,
        mapToColumns: mockMapToColumns,
      });

      const mockDoUpdateSet = {
        execute: vi.fn().mockResolvedValue(undefined),
      };

      const mockConflictBuilderForDoUpdateSet = {
        doUpdateSet: vi.fn().mockReturnValue(mockDoUpdateSet),
      };

      const mockOnConflictBuilder = {
        columns: vi.fn().mockReturnValue(mockConflictBuilderForDoUpdateSet),
      };

      const mockReadModelInsert = {
        values: vi.fn().mockReturnValue({
          onConflict: vi.fn((callback) => {
            // Call the callback with the mock conflict builder and return its result
            const result = callback(mockOnConflictBuilder);
            return result;
          }),
        }),
      };

      // Create a chainable mock that supports multiple .where() calls
      const mockWhereChain = {
        where: vi.fn().mockReturnThis(),
        forUpdate: vi.fn().mockReturnValue({
          executeTakeFirst: vi.fn().mockResolvedValue(null),
        }),
      };

      const mockDb = {
        selectFrom: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue(mockWhereChain),
        }),
        insertInto: vi.fn((table) => {
          if (table === "snapshots") {
            return {
              values: vi.fn().mockReturnValue({
                onConflict: vi.fn().mockReturnValue({
                  execute: vi.fn().mockResolvedValue(undefined),
                }),
              }),
            };
          }
          return mockReadModelInsert;
        }),
      } as any;

      const event = {
        type: "TestEvent",
        data: {},
        metadata: {
          streamId: "stream-1",
          streamPosition: 1n,
          globalPosition: 1n,
        },
      };

      await handler({ db: mockDb, partition: "partition-1" }, event);

      // Should use doUpdateSet when denormalized columns exist
      expect(mockDb.insertInto).toHaveBeenCalledWith("test_table");
      expect(mockReadModelInsert.values).toHaveBeenCalled();
      expect(mockConflictBuilderForDoUpdateSet.doUpdateSet).toHaveBeenCalled();

      // Verify the actual values passed to the insert query
      const valuesCall = mockReadModelInsert.values.mock.calls[0];
      expect(valuesCall).toBeDefined();
      expect(valuesCall[0]).toEqual({
        id: "test-id",
        status_text: "active", // Denormalized column from mapToColumns
      });
      // Should contain both keys and denormalized columns
      expect(Object.keys(valuesCall[0])).toEqual(["id", "status_text"]);
    });
  });

  describe("constructStreamId", () => {
    it("should construct stream ID from single key", () => {
      const keys = { id: "test-id" };
      const result = constructStreamId(keys);
      expect(result).toBe("id:test-id");
    });

    it("should sort keys alphabetically", () => {
      const keys = {
        z_key: "value-z",
        a_key: "value-a",
        m_key: "value-m",
      };
      const result = constructStreamId(keys);
      expect(result).toBe("a_key:value-a|m_key:value-m|z_key:value-z");
    });

    it("should produce same result regardless of key order", () => {
      const keys1 = {
        tenant_id: "tenant-1",
        cart_id: "cart-1",
      };
      const keys2 = {
        cart_id: "cart-1",
        tenant_id: "tenant-1",
      };
      const result1 = constructStreamId(keys1);
      const result2 = constructStreamId(keys2);
      expect(result1).toBe(result2);
      expect(result1).toBe("cart_id:cart-1|tenant_id:tenant-1");
    });

    it("should URL encode special characters in keys", () => {
      const keys = {
        "key|with|pipes": "value",
        "key:with:colons": "value",
      };
      const result = constructStreamId(keys);
      // Keys should be encoded - verify encoded versions are present
      expect(result).toContain(encodeURIComponent("key|with|pipes"));
      expect(result).toContain(encodeURIComponent("key:with:colons"));
      // The delimiter `|` should still be present between entries
      expect(result.split("|").length).toBe(2);
      // Verify that raw special characters from key names are not present (they should be encoded)
      expect(result).not.toContain("key|with|pipes");
      expect(result).not.toContain("key:with:colons");
      // But the delimiter `:` between key and value should still be present
      const parts = result.split("|");
      parts.forEach((part) => {
        // Each part should be encodedKey:value format
        const [encodedKey, value] = part.split(":");
        expect(encodedKey).toBeTruthy();
        expect(value).toBe("value");
      });
    });

    it("should URL encode special characters in values", () => {
      const keys = {
        key: "value|with|pipes",
        key2: "value:with:colons",
      };
      const result = constructStreamId(keys);
      expect(result).toContain(encodeURIComponent("value|with|pipes"));
      expect(result).toContain(encodeURIComponent("value:with:colons"));
      // The delimiter `|` should still be present between entries
      expect(result.split("|").length).toBe(2);
    });

    it("should handle empty string values", () => {
      const keys = {
        key1: "",
        key2: "value",
      };
      const result = constructStreamId(keys);
      expect(result).toBe("key1:|key2:value");
    });

    it("should handle empty keys object", () => {
      const keys = {};
      const result = constructStreamId(keys);
      expect(result).toBe("");
    });

    it("should handle unicode characters", () => {
      const keys = {
        key: "测试",
        key2: "🎉",
      };
      const result = constructStreamId(keys);
      expect(result).toContain(encodeURIComponent("测试"));
      expect(result).toContain(encodeURIComponent("🎉"));
    });

    it("should handle spaces and special URL characters", () => {
      const keys = {
        "key with spaces": "value with spaces",
        "key+plus": "value+plus",
        "key%percent": "value%percent",
        "key#hash": "value#hash",
      };
      const result = constructStreamId(keys);
      // All special characters should be encoded
      expect(result).toContain(encodeURIComponent("key with spaces"));
      expect(result).toContain(encodeURIComponent("value with spaces"));
      expect(result).toContain(encodeURIComponent("key+plus"));
      expect(result).toContain(encodeURIComponent("value+plus"));
    });

    it("should handle multiple keys with same values", () => {
      const keys = {
        key1: "same-value",
        key2: "same-value",
        key3: "different-value",
      };
      const result = constructStreamId(keys);
      // Should still produce deterministic result
      expect(result).toBe(
        "key1:same-value|key2:same-value|key3:different-value",
      );
    });

    it("should handle numeric string values", () => {
      const keys = {
        id: "123",
        version: "456",
      };
      const result = constructStreamId(keys);
      expect(result).toBe("id:123|version:456");
    });

    it("should handle very long key names and values", () => {
      const longKey = "a".repeat(1000);
      const longValue = "b".repeat(1000);
      const keys = {
        [longKey]: longValue,
      };
      const result = constructStreamId(keys);
      expect(result).toBe(
        `${encodeURIComponent(longKey)}:${encodeURIComponent(longValue)}`,
      );
      expect(result.length).toBeGreaterThan(2000);
    });

    it("should produce deterministic results for complex keys", () => {
      const keys = {
        tenant_id: "tenant-123",
        cart_id: "cart-456",
        partition: "partition-789",
        user_id: "user-abc",
      };
      const result1 = constructStreamId(keys);
      const result2 = constructStreamId(keys);
      expect(result1).toBe(result2);
      expect(result1).toBe(
        "cart_id:cart-456|partition:partition-789|tenant_id:tenant-123|user_id:user-abc",
      );
    });

    it("should handle keys that contain the delimiter characters", () => {
      const keys = {
        "key|with|pipe": "value|with|pipe",
        "key:with:colon": "value:with:colon",
      };
      const result = constructStreamId(keys);
      // Should encode delimiters so they don't interfere with parsing
      expect(result.split("|").length).toBe(2); // Should have 2 entries
      result.split("|").forEach((entry) => {
        expect(entry.split(":").length).toBe(2); // Each entry should have key:value
      });
    });
  });

  describe("loadStateFromSnapshot", () => {
    it("should return initial state when snapshot is null", () => {
      const initialState = vi.fn(() => ({ count: 0 }));
      const result = loadStateFromSnapshot(null, initialState);
      expect(result).toEqual({ count: 0 });
      expect(initialState).toHaveBeenCalledTimes(1);
    });

    it("should return initial state when snapshot is undefined", () => {
      const initialState = vi.fn(() => ({ status: "init" }));
      const result = loadStateFromSnapshot(undefined, initialState);
      expect(result).toEqual({ status: "init" });
      expect(initialState).toHaveBeenCalledTimes(1);
    });

    it("should return initial state when snapshot is empty string", () => {
      const initialState = vi.fn(() => ({}));
      const result = loadStateFromSnapshot("", initialState);
      expect(result).toEqual({});
      expect(initialState).toHaveBeenCalledTimes(1);
    });

    it("should parse string snapshot as JSON", () => {
      const snapshot = JSON.stringify({ count: 5, items: ["a", "b"] });
      const initialState = vi.fn(() => ({}));
      const result = loadStateFromSnapshot(snapshot, initialState);
      expect(result).toEqual({ count: 5, items: ["a", "b"] });
      expect(initialState).not.toHaveBeenCalled();
    });

    it("should return parsed object snapshot as-is", () => {
      const snapshot = { count: 10, status: "active" };
      const initialState = vi.fn(() => ({}));
      const result = loadStateFromSnapshot(snapshot, initialState);
      expect(result).toEqual({ count: 10, status: "active" });
      expect(initialState).not.toHaveBeenCalled();
    });

    it("should handle complex nested objects in string snapshot", () => {
      const complexState = {
        user: {
          id: "123",
          profile: {
            name: "Test",
            settings: {
              theme: "dark",
              notifications: true,
            },
          },
        },
        items: [
          { id: 1, name: "Item 1" },
          { id: 2, name: "Item 2" },
        ],
      };
      const snapshot = JSON.stringify(complexState);
      const initialState = vi.fn(() => ({}));
      const result = loadStateFromSnapshot(snapshot, initialState);
      expect(result).toEqual(complexState);
      expect(initialState).not.toHaveBeenCalled();
    });

    it("should handle arrays in string snapshot", () => {
      const snapshot = JSON.stringify([1, 2, 3, 4, 5]);
      const initialState = vi.fn(() => []);
      const result = loadStateFromSnapshot(snapshot, initialState);
      expect(result).toEqual([1, 2, 3, 4, 5]);
      expect(initialState).not.toHaveBeenCalled();
    });

    it("should handle arrays in parsed snapshot", () => {
      const snapshot = [1, 2, 3, 4, 5];
      const initialState = vi.fn(() => []);
      const result = loadStateFromSnapshot(snapshot, initialState);
      expect(result).toEqual([1, 2, 3, 4, 5]);
      expect(initialState).not.toHaveBeenCalled();
    });

    it("should handle primitive values in string snapshot", () => {
      const snapshot = JSON.stringify(42);
      const initialState = vi.fn(() => 0);
      const result = loadStateFromSnapshot(snapshot, initialState);
      expect(result).toBe(42);
      expect(initialState).not.toHaveBeenCalled();
    });

    it("should handle primitive values in parsed snapshot", () => {
      const snapshot = 42;
      const initialState = vi.fn(() => 0);
      const result = loadStateFromSnapshot(snapshot, initialState);
      expect(result).toBe(42);
      expect(initialState).not.toHaveBeenCalled();
    });

    it("should handle null value in string snapshot", () => {
      const snapshot = JSON.stringify(null);
      const initialState = vi.fn(() => ({}));
      const result = loadStateFromSnapshot(snapshot, initialState);
      expect(result).toBeNull();
      expect(initialState).not.toHaveBeenCalled();
    });

    it("should handle boolean values in string snapshot", () => {
      const snapshot = JSON.stringify(true);
      const initialState = vi.fn(() => false);
      const result = loadStateFromSnapshot(snapshot, initialState);
      expect(result).toBe(true);
      expect(initialState).not.toHaveBeenCalled();
    });

    it("should handle boolean true in parsed snapshot", () => {
      const snapshot = true;
      const initialState = vi.fn(() => false);
      const result = loadStateFromSnapshot(snapshot, initialState);
      expect(result).toBe(true);
      expect(initialState).not.toHaveBeenCalled();
    });

    it("should call initialState for boolean false (falsy value)", () => {
      const snapshot = false;
      const initialState = vi.fn(() => ({ default: true }));
      const result = loadStateFromSnapshot(snapshot, initialState);
      // false is falsy, so initialState is called
      expect(result).toEqual({ default: true });
      expect(initialState).toHaveBeenCalledTimes(1);
    });

    it("should preserve object references for parsed snapshots", () => {
      const snapshot = { count: 5 };
      const initialState = vi.fn(() => ({}));
      const result = loadStateFromSnapshot(snapshot, initialState);
      // Should be the same object reference (not a copy)
      expect(result).toBe(snapshot);
      expect(initialState).not.toHaveBeenCalled();
    });

    it("should handle empty object in string snapshot", () => {
      const snapshot = JSON.stringify({});
      const initialState = vi.fn(() => ({ default: true }));
      const result = loadStateFromSnapshot(snapshot, initialState);
      expect(result).toEqual({});
      expect(initialState).not.toHaveBeenCalled();
    });

    it("should handle empty array in string snapshot", () => {
      const snapshot = JSON.stringify([]);
      const initialState = vi.fn(() => [1, 2, 3]);
      const result = loadStateFromSnapshot(snapshot, initialState);
      expect(result).toEqual([]);
      expect(initialState).not.toHaveBeenCalled();
    });

    it("should throw error for invalid JSON string", () => {
      const snapshot = "{ invalid json }";
      const initialState = vi.fn(() => ({}));
      expect(() => loadStateFromSnapshot(snapshot, initialState)).toThrow();
      expect(initialState).not.toHaveBeenCalled();
    });

    it("should include table name in error message when provided", () => {
      const snapshot = "{ invalid json }";
      const initialState = vi.fn(() => ({}));
      expect(() =>
        loadStateFromSnapshot(snapshot, initialState, "test_table"),
      ).toThrow(/Failed to parse snapshot for table "test_table"/);
      expect(initialState).not.toHaveBeenCalled();
    });

    it("should include snapshot preview in error message", () => {
      const snapshot = "{ invalid json }";
      const initialState = vi.fn(() => ({}));
      expect(() => loadStateFromSnapshot(snapshot, initialState)).toThrow(
        /Snapshot value: \{ invalid json \}/,
      );
      expect(initialState).not.toHaveBeenCalled();
    });

    it("should truncate long snapshot values in error message", () => {
      const longInvalidJson = "{".repeat(1000) + " invalid }";
      const initialState = vi.fn(() => ({}));
      expect(() =>
        loadStateFromSnapshot(longInvalidJson, initialState, "test_table"),
      ).toThrow(/Snapshot value:.*\.\.\./);
      expect(initialState).not.toHaveBeenCalled();
    });

    it("should handle state with Date-like strings (as JSON doesn't preserve Date objects)", () => {
      const state = {
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-02T00:00:00.000Z",
      };
      const snapshot = JSON.stringify(state);
      const initialState = vi.fn(() => ({}));
      const result = loadStateFromSnapshot(snapshot, initialState);
      expect(result).toEqual(state);
      expect(initialState).not.toHaveBeenCalled();
    });

    it("should handle state with numbers, strings, and booleans", () => {
      const state = {
        count: 42,
        name: "test",
        active: true,
        score: 99.5,
      };
      const snapshot = JSON.stringify(state);
      const initialState = vi.fn(() => ({}));
      const result = loadStateFromSnapshot(snapshot, initialState);
      expect(result).toEqual(state);
      expect(initialState).not.toHaveBeenCalled();
    });

    it("should handle state with null values in object", () => {
      const state = {
        value: null,
        other: "not-null",
      };
      const snapshot = JSON.stringify(state);
      const initialState = vi.fn(() => ({}));
      const result = loadStateFromSnapshot(snapshot, initialState);
      expect(result).toEqual(state);
      expect(initialState).not.toHaveBeenCalled();
    });

    it("should handle very large numbers in string snapshot", () => {
      const state = {
        bigNumber: Number.MAX_SAFE_INTEGER,
        smallNumber: Number.MIN_SAFE_INTEGER,
      };
      const snapshot = JSON.stringify(state);
      const initialState = vi.fn(() => ({}));
      const result = loadStateFromSnapshot(snapshot, initialState);
      expect(result).toEqual(state);
      expect(initialState).not.toHaveBeenCalled();
    });

    it("should handle unicode characters in string snapshot", () => {
      const state = {
        text: "测试 🎉 émoji",
        name: "José",
      };
      const snapshot = JSON.stringify(state);
      const initialState = vi.fn(() => ({}));
      const result = loadStateFromSnapshot(snapshot, initialState);
      expect(result).toEqual(state);
      expect(initialState).not.toHaveBeenCalled();
    });
  });
});
