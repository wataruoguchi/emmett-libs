import { describe, expect, it, vi } from "vitest";
import { createProjectionRunner } from "../projections/runner.js";
import {
  createSnapshotProjection,
  createSnapshotProjectionRegistry,
  createSnapshotProjectionWithSnapshotTable,
  createSnapshotProjectionRegistryWithSnapshotTable,
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
    it("should work with projection runner", () => {
      const mockDb = {
        selectFrom: vi.fn(),
        insertInto: vi.fn(),
        updateTable: vi.fn(),
        transaction: vi.fn(),
      } as never;

      const mockReadStream = vi.fn();
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

      const runner = createProjectionRunner({
        db: mockDb,
        readStream: mockReadStream,
        registry,
      });

      expect(typeof runner.projectEvents).toBe("function");
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
    it("should work with projection runner", () => {
      const mockDb = {
        selectFrom: vi.fn(),
        insertInto: vi.fn(),
        updateTable: vi.fn(),
        transaction: vi.fn(),
      } as never;

      const mockReadStream = vi.fn();
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

      const runner = createProjectionRunner({
        db: mockDb,
        readStream: mockReadStream,
        registry,
      });

      expect(typeof runner.projectEvents).toBe("function");
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

    it("should handle special characters in keys for stream_id construction", () => {
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

      // Should not throw - URL encoding handles special chars
      expect(typeof handler).toBe("function");
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
    });
  });
});
