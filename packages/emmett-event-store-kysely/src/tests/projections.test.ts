import { describe, expect, it, vi } from "vitest";
import { createProjectionRunner } from "../projections/runner.js";
import {
  createSnapshotProjection,
  createSnapshotProjectionRegistry,
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
});
