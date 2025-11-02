// Import official Emmett types instead of defining our own
import type {
  Event,
  ReadEvent,
  ReadEventMetadataWithGlobalPosition,
} from "@event-driven-io/emmett";

export type Logger = {
  info: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
  warn?: (obj: unknown, msg?: string) => void;
  debug?: (obj: unknown, msg?: string) => void;
};

export type EncryptionMetadata = {
  enc: {
    algo: SupportedAlgorithm;
    keyId: string;
    keyVersion: number;
    iv: string; // base64
    aadHash?: string;
    streamType?: string; // Stored for AAD reconstruction during decryption
    eventType?: string; // Stored for AAD reconstruction during decryption
  };
};

export type CryptoContext = {
  partition: string;
  streamId: string;
  streamType?: string;
  eventType?: string;
};

export interface EncryptionPolicyResolver {
  resolve(
    ctx: CryptoContext,
  ): Promise<
    | { encrypt: true; algo: SupportedAlgorithm; keyRef: string }
    | { encrypt: false }
  >;
}

export interface KeyManagement {
  getActiveKey(params: {
    partition: string;
    keyRef: string;
  }): Promise<{ keyId: string; keyVersion: number; keyBytes: Uint8Array }>;
  getKeyById(params: { partition: string; keyId: string }): Promise<{
    keyId: string;
    keyVersion: number;
    keyBytes: Uint8Array;
  } | null>;
  rotateKey(params: { partition: string; keyRef: string }): Promise<{
    keyId: string;
    keyVersion: number;
  }>;
  destroyPartitionKeys(partition: string): Promise<void>;
}

// Supported encryption algorithms (Web Crypto API compatible)
// Note: Support varies by runtime environment
export type SupportedAlgorithm =
  | "AES-GCM" // Universal support (authenticated encryption)
  | "AES-CBC" // Universal support (needs separate MAC)
  | "AES-CTR"; // Node.js support, limited browser support

// Crypto operation parameters
export interface CryptoOperationParams {
  algorithm: SupportedAlgorithm;
  key: Uint8Array;
  iv: Uint8Array;
  data: Uint8Array;
  aad?: Uint8Array;
}

// Encryption result with metadata
export interface EncryptionResult {
  ciphertext: Uint8Array;
  algorithm: SupportedAlgorithm;
  iv: Uint8Array;
  aad?: Uint8Array;
}

// Decryption result
export interface DecryptionResult {
  plaintext: Uint8Array;
}

export interface CryptoProvider {
  encrypt(
    algo: SupportedAlgorithm,
    key: Uint8Array,
    iv: Uint8Array,
    plaintext: Uint8Array,
    aad?: Uint8Array,
  ): Promise<Uint8Array>;
  decrypt(
    algo: SupportedAlgorithm,
    key: Uint8Array,
    iv: Uint8Array,
    ciphertext: Uint8Array,
    aad?: Uint8Array,
  ): Promise<Uint8Array>;
}

export type DecryptHook = (
  event: ReadEvent<Event, ReadEventMetadataWithGlobalPosition>,
) => Promise<ReadEvent<Event, ReadEventMetadataWithGlobalPosition>>;
