import { describe, expect, it, vi } from "vitest";
import { createCryptoEventStore } from "../index.js";
import type {
  CryptoProvider,
  EncryptionPolicyResolver,
  KeyManagement,
} from "../types.js";

// Logger type for tests
type Logger = {
  info: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
  warn?: (obj: unknown, msg?: string) => void;
  debug?: (obj: unknown, msg?: string) => void;
};

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function json(data: unknown): Uint8Array {
  return utf8(JSON.stringify(data));
}

describe("Feature: Crypto Event Store", () => {
  // Helper functions for creating test mocks
  function createMockBaseEventStore() {
    return {
      appendToStream: vi.fn(async (_n: string, e: any[]) => ({ events: e })),
      readStream: vi.fn(),
    } as any;
  }

  function createMockPolicy(
    shouldEncrypt: boolean,
    algo: "AES-GCM" = "AES-GCM",
  ): EncryptionPolicyResolver {
    return {
      resolve: vi.fn(async () =>
        shouldEncrypt
          ? {
              encrypt: true as const,
              algo: algo,
              keyRef: "ref",
            }
          : { encrypt: false as const },
      ),
    };
  }

  function createMockKeys(): KeyManagement {
    return {
      getActiveKey: vi.fn(async () => ({
        keyId: "kid",
        keyVersion: 1,
        keyBytes: new Uint8Array(32),
      })),
      getKeyById: vi.fn(async () => ({
        keyId: "kid",
        keyVersion: 1,
        keyBytes: new Uint8Array(32),
      })),
      rotateKey: vi.fn(),
      destroyPartitionKeys: vi.fn(),
    };
  }

  function createMockCrypto(
    encryptImpl?: (
      _a: string,
      _k: Uint8Array,
      _iv: Uint8Array,
      pt: Uint8Array,
      _aad?: Uint8Array,
    ) => Promise<Uint8Array>,
    decryptImpl?: (
      _a: string,
      _k: Uint8Array,
      _iv: Uint8Array,
      ct: Uint8Array,
      _aad?: Uint8Array,
    ) => Promise<Uint8Array>,
  ): CryptoProvider {
    return {
      encrypt:
        encryptImpl ??
        vi.fn(async (_a, _k, _iv, pt, _aad) => new Uint8Array([...pt, 1])),
      decrypt:
        decryptImpl ??
        vi.fn(
          async (_a, _k, _iv, ct, _aad) =>
            new Uint8Array(ct.slice(0, ct.length - 1)),
        ),
    };
  }

  function createMockLogger(): Logger {
    return {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };
  }

  function createEventStore(
    base: ReturnType<typeof createMockBaseEventStore>,
    overrides?: {
      policy?: EncryptionPolicyResolver;
      keys?: KeyManagement;
      crypto?: CryptoProvider;
      buildAAD?: (ctx: { partition: string; streamId: string }) => Uint8Array;
      logger?: Logger;
    },
  ) {
    return createCryptoEventStore(base, {
      policy: overrides?.policy ?? createMockPolicy(true),
      keys: overrides?.keys ?? createMockKeys(),
      crypto: overrides?.crypto ?? createMockCrypto(),
      buildAAD:
        overrides?.buildAAD ??
        (({ partition, streamId }) => utf8(`${partition}:${streamId}`)),
      logger: overrides?.logger ?? createMockLogger(),
    });
  }

  describe("Scenario: Encrypting events on append", () => {
    it("Given a policy requires encryption, When appending events, Then events should be encrypted with metadata", async () => {
      const base = createMockBaseEventStore();
      const store = createEventStore(base);

      const events = [{ type: "X", data: { a: 1 } }];
      await (store as any).appendToStream("s1", events, { partition: "p1" });

      // Verify encryption was applied
      expect(base.appendToStream).toHaveBeenCalledTimes(1);
      const appended = base.appendToStream.mock.calls[0][1][0];
      expect(typeof appended.data.ciphertext).toBe("string");
      expect(appended.metadata.enc).toEqual({
        algo: "AES-GCM",
        keyId: "kid",
        keyVersion: 1,
        iv: expect.any(String),
        streamType: undefined, // No streamType in options
        eventType: "X", // Event type is stored
      });
    });

    it("Given an unexpected error in policy storage, When appending events, Then events should remain unencrypted for safety", async () => {
      const base = createMockBaseEventStore();

      // Mock storage layer to throw unexpected error (simulating database connection issue)
      const storageMock = {
        findPolicy: vi.fn(async () => {
          throw new Error("Database connection lost");
        }),
      };

      // Create policy resolver with the failing storage
      const { createPolicyResolver } = await import(
        "../policy/policy.resolver.js"
      );
      const onErrorMock = vi.fn();
      const policyResolver = createPolicyResolver(storageMock, onErrorMock);

      const store = createEventStore(base, {
        policy: policyResolver,
      });

      const evt = { type: "X", data: { a: 1 } };
      await (store as any).appendToStream("s1", [evt], {
        partition: "p1",
        streamType: "test-type",
      });

      // Verify error was logged
      expect(onErrorMock).toHaveBeenCalled();

      // Verify no encryption was applied (graceful degradation)
      const appended = base.appendToStream.mock.calls[0][1][0];
      expect(appended.data).toEqual({ a: 1 });
      expect((appended as any).metadata?.enc).toBeUndefined();
    });
  });

  describe("Scenario: Decrypting events on read", () => {
    it("Given encrypted events, When reading stream, Then events should be decrypted", async () => {
      const encoded = json({ a: 1 });
      const encrypted = new Uint8Array([...encoded, 1]);
      const base = createMockBaseEventStore();
      base.readStream = vi.fn(async () => ({
        events: [
          {
            type: "X",
            data: { ciphertext: Buffer.from(encrypted).toString("base64") },
            metadata: {
              enc: {
                algo: "AES-GCM",
                keyId: "kid",
                keyVersion: 1,
                iv: Buffer.from(new Uint8Array(12)).toString("base64"),
              },
            },
          },
        ],
      }));

      const store = createEventStore(base, {
        crypto: createMockCrypto(
          async () => new Uint8Array([]),
          async (_a, _k, _iv, ct) =>
            new Uint8Array(
              Buffer.from(Buffer.from(ct).slice(0, Buffer.from(ct).length - 1)),
            ),
        ),
      });

      const res = await (store as any).readStream("s1", { partition: "p1" });
      expect(res.events[0].data).toEqual({ a: 1 });
    });

    it("Given invalid encrypted payload format, When reading stream, Then it should skip the event gracefully", async () => {
      const base = createMockBaseEventStore();
      base.readStream = vi.fn(async () => ({
        events: [
          {
            type: "X",
            data: 42, // Invalid format - not string or object with ciphertext
            metadata: {
              enc: {
                algo: "AES-GCM",
                keyId: "kid",
                keyVersion: 1,
                iv: Buffer.from(new Uint8Array(12)).toString("base64"),
              },
            },
          },
        ],
      }));

      const store = createEventStore(base, {
        crypto: createMockCrypto(
          async () => new Uint8Array([]),
          async () => new Uint8Array([]),
        ),
      });

      // With graceful error handling, invalid data format is logged and skipped
      const result = await (store as any).readStream("s1", { partition: "p1" });
      expect(result.events).toEqual([]); // Invalid events are skipped
    });

    it("Given encrypted event with destroyed key, When reading stream, Then it should skip event gracefully", async () => {
      const logger = createMockLogger();
      const keys = createMockKeys();

      const encoded = json({ value: 5 });
      const encrypted = new Uint8Array([...encoded, 1]);
      const base = createMockBaseEventStore();
      base.readStream = vi.fn(async () => ({
        events: [
          {
            type: "X",
            data: { ciphertext: Buffer.from(encrypted).toString("base64") },
            metadata: {
              enc: {
                algo: "AES-GCM",
                keyId: "destroyed-key-id",
                keyVersion: 1,
                iv: Buffer.from(new Uint8Array(12)).toString("base64"),
              },
              streamPosition: 1n,
            },
          },
          {
            type: "Y",
            data: { ciphertext: Buffer.from(encrypted).toString("base64") },
            metadata: {
              enc: {
                algo: "AES-GCM",
                keyId: "valid-key-id",
                keyVersion: 1,
                iv: Buffer.from(new Uint8Array(12)).toString("base64"),
              },
              streamPosition: 2n,
            },
          },
        ],
      }));

      // First call returns null (destroyed key), second returns valid key
      keys.getKeyById = vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          keyId: "valid-key-id",
          keyVersion: 1,
          keyBytes: new Uint8Array(32),
        });

      const store = createEventStore(base, {
        keys,
        logger,
        crypto: createMockCrypto(
          async () => new Uint8Array([]),
          async (_a, _k, _iv, ct) =>
            new Uint8Array(
              Buffer.from(Buffer.from(ct).slice(0, Buffer.from(ct).length - 1)),
            ),
        ),
      });

      const res = await (store as any).readStream("s1", { partition: "p1" });

      // Should filter out the event with destroyed key
      expect(res.events).toHaveLength(1);
      expect(res.events[0].type).toBe("Y");
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          keyId: "destroyed-key-id",
        }),
        expect.stringContaining("Key not found"),
      );
    });

    it("Given encrypted event with string data, When reading stream, Then it should decrypt correctly", async () => {
      const encoded = json({ a: 1 });
      const encrypted = new Uint8Array([...encoded, 1]);
      const base = createMockBaseEventStore();
      base.readStream = vi.fn(async () => ({
        events: [
          {
            type: "X",
            data: Buffer.from(encrypted).toString("base64"), // String format
            metadata: {
              enc: {
                algo: "AES-GCM",
                keyId: "kid",
                keyVersion: 1,
                iv: Buffer.from(new Uint8Array(12)).toString("base64"),
              },
            },
          },
        ],
      }));

      const store = createEventStore(base, {
        crypto: createMockCrypto(
          async () => new Uint8Array([]),
          async (_a, _k, _iv, ct) =>
            new Uint8Array(
              Buffer.from(Buffer.from(ct).slice(0, Buffer.from(ct).length - 1)),
            ),
        ),
      });

      const res = await (store as any).readStream("s1", { partition: "p1" });
      expect(res.events[0].data).toEqual({ a: 1 });
    });
  });

  describe("Scenario: Using session", () => {
    it("Given base store with withSession, When using session, Then it should wrap session event store", async () => {
      const base = createMockBaseEventStore();
      const sessionCallback = vi.fn(async (session: any) => {
        expect(session.eventStore).toBeDefined();
        return "session-result";
      });
      base.withSession = vi.fn().mockImplementation(async (cb) => {
        const mockSession = {
          eventStore: createMockBaseEventStore(),
          close: vi.fn(),
        };
        return await cb(mockSession);
      });

      const store = createEventStore(base);
      const result = await (store as any).withSession(sessionCallback);

      expect(result).toBe("session-result");
      expect(base.withSession).toHaveBeenCalled();
      expect(sessionCallback).toHaveBeenCalled();
    });

    it("Given base store without withSession, When using session, Then it should use fallback", async () => {
      const base = createMockBaseEventStore();
      // No withSession method
      delete (base as any).withSession;

      const sessionCallback = vi.fn(async (session: any) => {
        expect(session.eventStore).toBeDefined();
        expect(typeof session.close).toBe("function");
        return "fallback-result";
      });

      const store = createEventStore(base);
      const result = await (store as any).withSession(sessionCallback);

      expect(result).toBe("fallback-result");
      expect(sessionCallback).toHaveBeenCalled();
    });

    it("Given session event store, When appending in session, Then events should be encrypted", async () => {
      const base = createMockBaseEventStore();
      const sessionStore = createMockBaseEventStore();
      base.withSession = vi.fn().mockImplementation(async (cb) => {
        return await cb({ eventStore: sessionStore, close: vi.fn() });
      });

      const store = createEventStore(base);
      await (store as any).withSession(async (session: any) => {
        await session.eventStore.appendToStream(
          "s1",
          [{ type: "X", data: { a: 1 } }],
          {
            partition: "p1",
          },
        );
      });

      expect(sessionStore.appendToStream).toHaveBeenCalled();
    });
  });

  describe("Scenario: Aggregating stream", () => {
    it("Given encrypted events, When aggregating stream, Then events should be decrypted before aggregation", async () => {
      const encoded = json({ value: 10 });
      const encrypted = new Uint8Array([...encoded, 1]);
      const base = createMockBaseEventStore();
      base.readStream = vi.fn(async () => ({
        events: [
          {
            type: "CounterIncremented",
            data: { ciphertext: Buffer.from(encrypted).toString("base64") },
            metadata: {
              enc: {
                algo: "AES-GCM",
                keyId: "kid",
                keyVersion: 1,
                iv: Buffer.from(new Uint8Array(12)).toString("base64"),
              },
              streamPosition: 1n,
            },
          },
        ],
        currentStreamVersion: 1n,
        streamExists: true,
      }));

      const store = createEventStore(base, {
        crypto: createMockCrypto(
          async () => new Uint8Array([]),
          async (_a, _k, _iv, ct) =>
            new Uint8Array(
              Buffer.from(Buffer.from(ct).slice(0, Buffer.from(ct).length - 1)),
            ),
        ),
      });

      const result = await (store as any).aggregateStream("counter-stream", {
        evolve: (state: { count: number }, event: any) => ({
          ...state,
          count: state.count + event.data.value,
        }),
        initialState: () => ({ count: 0 }),
      });

      expect(result.state).toEqual({ count: 10 });
      expect(result.currentStreamVersion).toBe(1n);
      expect(result.streamExists).toBe(true);
    });

    it("Given events with destroyed key, When aggregating stream, Then destroyed events should be filtered out", async () => {
      const logger = createMockLogger();
      const keys = createMockKeys();
      keys.getKeyById = vi
        .fn()
        .mockResolvedValueOnce(null) // First key destroyed
        .mockResolvedValueOnce({
          // Second key valid
          keyId: "valid-key-id",
          keyVersion: 1,
          keyBytes: new Uint8Array(32),
        });

      const encoded = json({ value: 5 });
      const encrypted = new Uint8Array([...encoded, 1]);
      const base = createMockBaseEventStore();
      base.readStream = vi.fn(async () => ({
        events: [
          {
            type: "CounterIncremented",
            data: { ciphertext: Buffer.from(encrypted).toString("base64") },
            metadata: {
              enc: {
                algo: "AES-GCM",
                keyId: "destroyed-key-id",
                keyVersion: 1,
                iv: Buffer.from(new Uint8Array(12)).toString("base64"),
              },
              streamPosition: 1n,
            },
          },
          {
            type: "CounterIncremented",
            data: { ciphertext: Buffer.from(encrypted).toString("base64") },
            metadata: {
              enc: {
                algo: "AES-GCM",
                keyId: "valid-key-id",
                keyVersion: 1,
                iv: Buffer.from(new Uint8Array(12)).toString("base64"),
              },
              streamPosition: 2n,
            },
          },
        ],
        currentStreamVersion: 2n,
        streamExists: true,
      }));

      const store = createEventStore(base, {
        keys,
        logger,
        crypto: createMockCrypto(
          async () => new Uint8Array([]),
          async (_a, _k, _iv, ct) =>
            new Uint8Array(
              Buffer.from(Buffer.from(ct).slice(0, Buffer.from(ct).length - 1)),
            ),
        ),
      });

      const result = await (store as any).aggregateStream("counter-stream", {
        evolve: (state: { count: number }, event: any) => ({
          ...state,
          count: state.count + event.data.value,
        }),
        initialState: () => ({ count: 0 }),
      });

      // Only the second event (with valid key) should be processed
      expect(result.state).toEqual({ count: 5 });
    });

    it("Given expected version mismatch, When aggregating stream, Then it should throw version mismatch error", async () => {
      const base = createMockBaseEventStore();
      base.readStream = vi.fn(async () => ({
        events: [],
        currentStreamVersion: 5n,
        streamExists: true,
      }));

      const store = createEventStore(base);

      await expect(
        (store as any).aggregateStream("test-stream", {
          evolve: (s: any) => s,
          initialState: () => ({}),
          read: { expectedStreamVersion: 3n },
        }),
      ).rejects.toThrow(
        /Expected version 3 does not match current 5|version.*mismatch|does not match/i,
      );
    });

    it("Given logger, When aggregating stream, Then it should log debug info", async () => {
      const logger = createMockLogger();
      const base = createMockBaseEventStore();
      base.readStream = vi.fn(async () => ({
        events: [],
        currentStreamVersion: 0n,
        streamExists: false,
      }));

      const store = createEventStore(base, { logger });

      await (store as any).aggregateStream("test-stream", {
        evolve: (s: any) => s,
        initialState: () => ({}),
      });

      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          streamName: "test-stream",
        }),
        "aggregateStream",
      );
    });
  });

  describe("Scenario: AAD Context Consistency", () => {
    it("Given buildAAD uses streamType and eventType, When encrypting and decrypting, Then streamType and eventType should be stored and used", async () => {
      // Track AAD calls to verify consistency
      const aadCalls: Array<{
        partition?: string;
        streamId?: string;
        streamType?: string;
        eventType?: string;
      }> = [];

      // Create a buildAAD that uses all context fields and tracks calls
      const buildAADWithAllFields = (ctx: {
        partition?: string;
        streamId?: string;
        streamType?: string;
        eventType?: string;
      }) => {
        aadCalls.push({ ...ctx });
        const parts = [
          ctx.partition,
          ctx.streamId,
          ctx.streamType,
          ctx.eventType,
        ].filter(Boolean);
        return new TextEncoder().encode(parts.join(":"));
      };

      const base = createMockBaseEventStore();
      const store = createEventStore(base, {
        buildAAD: buildAADWithAllFields,
      });

      // Encrypt with streamType and eventType
      const events = [{ type: "TestEvent", data: { value: 42 } }];
      await (store as any).appendToStream("test-stream", events, {
        partition: "test-partition",
        streamType: "test-type",
      });

      // Verify streamType and eventType are stored in metadata
      const appended = base.appendToStream.mock.calls[0][1][0];
      expect(appended.metadata.enc.streamType).toBe("test-type");
      expect(appended.metadata.enc.eventType).toBe("TestEvent");

      // Verify AAD was called during encryption with full context
      expect(aadCalls.length).toBeGreaterThan(0);
      const encryptAADCall = aadCalls[0];
      expect(encryptAADCall.streamType).toBe("test-type");
      expect(encryptAADCall.eventType).toBe("TestEvent");

      // Clear AAD calls to track decryption
      aadCalls.length = 0;

      // Mock readStream to return the encrypted event
      base.readStream = vi.fn(async () => ({
        events: [appended],
      }));

      // Decrypt - should work because AAD context is reconstructed from stored metadata
      const result = await (store as any).readStream("test-stream", {
        partition: "test-partition",
      });

      // Verify AAD was called during decryption with same context from stored metadata
      expect(aadCalls.length).toBeGreaterThan(0);
      const decryptAADCall = aadCalls[0];
      expect(decryptAADCall.streamType).toBe("test-type"); // Retrieved from metadata
      expect(decryptAADCall.eventType).toBe("TestEvent"); // Retrieved from metadata
      expect(decryptAADCall.partition).toBe("test-partition");
      expect(decryptAADCall.streamId).toBe("test-stream");

      // Verify decryption succeeded (AAD matched)
      expect(result.events.length).toBe(1);
      expect(result.events[0].data).toEqual({ value: 42 });
    });

    it("Given buildAAD uses streamType and eventType, When decrypting without stored values, Then AAD should use undefined", async () => {
      // This tests backward compatibility with old encrypted events that don't have streamType/eventType
      const buildAADSpy = vi.fn(
        (ctx: {
          partition?: string;
          streamId?: string;
          streamType?: string;
          eventType?: string;
        }) => {
          // buildAAD that uses all fields
          const parts = [
            ctx.partition,
            ctx.streamId,
            ctx.streamType ?? "no-type",
            ctx.eventType ?? "no-event",
          ];
          return new TextEncoder().encode(parts.join(":"));
        },
      );

      const base = createMockBaseEventStore();
      base.readStream = vi.fn(async () => ({
        events: [
          {
            type: "X",
            data: { ciphertext: "dummy" },
            metadata: {
              enc: {
                algo: "AES-GCM",
                keyId: "kid",
                keyVersion: 1,
                iv: Buffer.from(new Uint8Array(12)).toString("base64"),
                // No streamType or eventType (old format)
              },
            },
          },
        ],
      }));

      const store = createEventStore(base, {
        buildAAD: buildAADSpy,
        crypto: createMockCrypto(
          async () => new Uint8Array([1, 2, 3]),
          async () => new TextEncoder().encode('{"a":1}'),
        ),
      });

      await (store as any).readStream("s1", { partition: "p1" });

      // Verify buildAAD was called with undefined for streamType and eventType
      expect(buildAADSpy).toHaveBeenCalledWith({
        partition: "p1",
        streamId: "s1",
        streamType: undefined,
        eventType: undefined,
      });
    });
  });
});
