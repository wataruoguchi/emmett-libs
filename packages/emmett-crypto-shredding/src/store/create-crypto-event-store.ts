import {
  assertExpectedVersionMatchesCurrent,
  type AggregateStreamOptions,
  type AggregateStreamResult,
  type AppendToStreamOptions,
  type AppendToStreamResultWithGlobalPosition,
  type Event,
  type ReadEvent,
  type ReadEventMetadataWithGlobalPosition,
  type ReadStreamOptions,
  type ReadStreamResult,
} from "@event-driven-io/emmett";

import { InvalidDataFormatError } from "../errors.js";
import type {
  CryptoContext,
  CryptoProvider,
  EncryptionMetadata,
  EncryptionPolicyResolver,
  KeyManagement,
  Logger,
} from "../types.js";

function toBase64(data: Uint8Array): string {
  return Buffer.from(data).toString("base64");
}

function fromBase64(data: string): Uint8Array {
  return Buffer.from(data, "base64");
}

function isEncryptedPayload(data: unknown): data is { ciphertext: string } {
  return (
    typeof data === "object" &&
    data !== null &&
    typeof (data as Record<string, unknown>).ciphertext === "string"
  );
}

export function createCryptoEventStore<TEventStore>(
  base: TEventStore,
  deps: {
    policy: EncryptionPolicyResolver;
    keys: KeyManagement;
    crypto: CryptoProvider;
    buildAAD?: (ctx: CryptoContext) => Uint8Array;
    getPartition?: (options?: unknown) => string | undefined;
    getStreamType?: (options?: unknown) => string | undefined;
    logger?: Logger;
    withSession?: <T = unknown>(
      callback: (session: {
        eventStore: TEventStore;
        close: () => Promise<void>;
      }) => Promise<T>,
    ) => Promise<T>;
    aggregateStream?: <State, EventType extends Event>(
      streamName: string,
      options: AggregateStreamOptions<
        State,
        EventType,
        ReadEventMetadataWithGlobalPosition
      >,
    ) => Promise<AggregateStreamResult<State>>;
  },
): TEventStore {
  async function encryptEvent(
    streamName: string,
    e: Event,
    options?: AppendToStreamOptions & {
      partition?: string;
      streamType?: string;
    },
  ): Promise<Event> {
    const partition = String(options?.partition ?? "default_partition");
    const streamType = options?.streamType;
    const ctx: CryptoContext = {
      partition,
      streamId: streamName,
      streamType,
      eventType: e.type,
    };
    const policyDecision = await deps.policy.resolve(ctx);
    if (!policyDecision.encrypt) {
      deps.logger?.debug?.(
        { ctx, policyDecision },
        "Policy resolution returned encrypt: false, skipping encryption",
      );
      return e;
    }
    try {
      const { keyId, keyVersion, keyBytes } = await deps.keys.getActiveKey({
        partition,
        keyRef: policyDecision.keyRef,
      });
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const aad = deps.buildAAD?.(ctx);
      const plaintext = new TextEncoder().encode(JSON.stringify(e.data));
      const ciphertext = await deps.crypto.encrypt(
        policyDecision.algo,
        keyBytes,
        iv,
        plaintext,
        aad,
      );
      return {
        ...e,
        data: { ciphertext: toBase64(ciphertext) },
        ...("metadata" in e && e.metadata
          ? {
              metadata: {
                ...(e.metadata as Record<string, unknown>),
                enc: {
                  algo: policyDecision.algo,
                  keyId,
                  keyVersion,
                  iv: toBase64(iv),
                  streamType,
                  eventType: e.type,
                },
              } as EncryptionMetadata,
            }
          : {
              metadata: {
                enc: {
                  algo: policyDecision.algo,
                  keyId,
                  keyVersion,
                  iv: toBase64(iv),
                  streamType,
                  eventType: e.type,
                },
              } as EncryptionMetadata,
            }),
      } as Event;
    } catch (error) {
      // Log encryption failure and re-throw to prevent silent failures
      deps.logger?.error?.(
        {
          error,
          ctx,
          algorithm: policyDecision.algo,
          keyRef: policyDecision.keyRef,
        },
        "Failed to encrypt event",
      );
      throw error;
    }
  }

  async function decryptEvent<EventType extends Event>(
    streamName: string,
    ev: ReadEvent<EventType, ReadEventMetadataWithGlobalPosition>,
    options?: ReadStreamOptions<bigint> & { partition?: string },
  ): Promise<ReadEvent<EventType, ReadEventMetadataWithGlobalPosition> | null> {
    const meta = (ev.metadata as Record<string, unknown>)?.enc as
      | EncryptionMetadata["enc"]
      | undefined;
    if (!meta) return ev;
    const partition = String(options?.partition ?? "default_partition");
    // Reconstruct the full CryptoContext using stored streamType and eventType from metadata
    // This ensures AAD matches what was used during encryption
    const streamId =
      ev.metadata && "streamId" in ev.metadata
        ? String(ev.metadata.streamId)
        : streamName;
    const aad = deps.buildAAD?.({
      partition,
      streamId,
      streamType: meta.streamType,
      eventType: meta.eventType,
    });
    // Look up the specific key version that was used to encrypt this event
    // This supports key rotation by allowing decryption of historical events
    const keyLookup = await deps.keys.getKeyById({
      partition,
      keyId: meta.keyId,
    });
    if (!keyLookup) {
      // Key was destroyed (crypto shredding) - gracefully skip this event
      // This allows other events in the stream to be decrypted and processed
      deps.logger?.info?.(
        {
          keyId: meta.keyId,
          streamName,
          streamPosition: ev.metadata?.streamPosition,
          partition,
        },
        `Key not found for decryption (may have been destroyed or rotated). Skipping event.`,
      );
      return null;
    }
    const { keyBytes } = keyLookup;
    const rawData: unknown = ev.data;
    let ciphertextB64: string;
    if (typeof rawData === "string") ciphertextB64 = rawData;
    else if (isEncryptedPayload(rawData)) ciphertextB64 = rawData.ciphertext;
    else
      throw new InvalidDataFormatError(
        `Invalid encrypted payload format. Expected string or object with 'ciphertext' property, got ${typeof rawData}`,
        "string or { ciphertext: string }",
        typeof rawData,
      );

    const plaintext = await deps.crypto.decrypt(
      meta.algo,
      keyBytes,
      fromBase64(meta.iv),
      fromBase64(ciphertextB64),
      aad,
    );
    return {
      ...ev,
      data: JSON.parse(
        new TextDecoder().decode(plaintext),
      ) as EventType["data"],
    } as ReadEvent<EventType, ReadEventMetadataWithGlobalPosition>;
  }

  const wrapped = {
    ...base,
    async withSession<T = unknown>(
      callback: (session: {
        eventStore: TEventStore;
        close: () => Promise<void>;
      }) => Promise<T>,
    ): Promise<T> {
      const baseWithSession = (
        base as {
          withSession?: <TResult = unknown>(
            callback: (session: {
              eventStore: TEventStore;
              close: () => Promise<void>;
            }) => Promise<TResult>,
          ) => Promise<TResult>;
        }
      ).withSession;
      if (typeof baseWithSession === "function") {
        return baseWithSession((session) =>
          callback({
            ...session,
            eventStore: createCryptoEventStore(session.eventStore, deps),
          }),
        );
      }
      // Fallback (no sessions available)
      return callback({ eventStore: wrapped, close: async () => {} });
    },
    async appendToStream<EventType extends Event>(
      streamName: string,
      events: EventType[],
      options?: AppendToStreamOptions & {
        partition?: string;
        streamType?: string;
      },
    ): Promise<AppendToStreamResultWithGlobalPosition> {
      const processed = await Promise.all(
        events.map((e) => encryptEvent(streamName, e, options)),
      );
      return (
        base as {
          appendToStream: (
            streamName: string,
            events: Event[],
            options?: AppendToStreamOptions,
          ) => Promise<AppendToStreamResultWithGlobalPosition>;
        }
      ).appendToStream(streamName, processed, options);
    },
    async readStream<EventType extends Event = Event>(
      streamName: string,
      options?: ReadStreamOptions<bigint> & { partition?: string },
    ): Promise<
      ReadStreamResult<EventType, ReadEventMetadataWithGlobalPosition>
    > {
      const res = await (
        base as {
          readStream: <E extends Event = Event>(
            streamName: string,
            options?: ReadStreamOptions<bigint>,
          ) => Promise<
            ReadStreamResult<E, ReadEventMetadataWithGlobalPosition>
          >;
        }
      ).readStream<EventType>(streamName, options);
      // Decrypt events, catching any decryption errors gracefully
      const decryptedEvents = await Promise.allSettled(
        res.events.map((ev) => decryptEvent(streamName, ev, options)),
      );
      // Filter out null events and failed decryptions
      // This allows other events in the stream to be decrypted and processed
      const events: ReadEvent<
        EventType,
        ReadEventMetadataWithGlobalPosition
      >[] = [];
      for (const result of decryptedEvents) {
        if (result.status === "fulfilled" && result.value !== null) {
          events.push(result.value);
        } else if (result.status === "rejected") {
          // Decryption failed (e.g., tampered ciphertext, invalid format)
          // Log the error and skip this event
          deps.logger?.error?.(
            {
              error: result.reason,
              streamName,
              partition: options?.partition,
            },
            "Failed to decrypt event, skipping",
          );
        }
        // If status is "fulfilled" but value is null, skip it (key destroyed)
      }
      return { ...res, events };
    },
    async aggregateStream<State, EventType extends Event>(
      streamName: string,
      options: AggregateStreamOptions<
        State,
        EventType,
        ReadEventMetadataWithGlobalPosition
      >,
    ): Promise<AggregateStreamResult<State>> {
      // Destructure options to match base store pattern
      const { evolve, initialState, read } = options;
      deps.logger?.debug?.({ streamName, options }, "aggregateStream");

      // Use wrapped readStream to ensure events are decrypted before aggregation
      const expectedStreamVersion = read?.expectedStreamVersion;
      const result = await wrapped.readStream<EventType>(streamName, read);

      // Validate expected version matches (same as base store)
      assertExpectedVersionMatchesCurrent(
        result.currentStreamVersion,
        expectedStreamVersion,
        0n, // Default stream version
      );

      // Filter out null events (events that couldn't be decrypted due to destroyed keys)
      // before aggregating to avoid processing incomplete state
      const decryptableEvents: ReadEvent<
        EventType,
        ReadEventMetadataWithGlobalPosition
      >[] = [];
      for (const ev of result.events) {
        if (ev !== null) {
          decryptableEvents.push(ev);
        }
      }

      const state = decryptableEvents.reduce(
        (
          state: State,
          event: ReadEvent<EventType, ReadEventMetadataWithGlobalPosition>,
        ) => evolve(state, event),
        initialState(),
      );

      return {
        state,
        currentStreamVersion: result.currentStreamVersion,
        streamExists: result.streamExists,
      };
    },
    // Overwrite with custom implementations if provided
    ...(deps.withSession ? { withSession: deps.withSession } : {}),
    ...(deps.aggregateStream ? { aggregateStream: deps.aggregateStream } : {}),
    _tag: "CryptoEventStore",
  };

  return wrapped as TEventStore;
}
