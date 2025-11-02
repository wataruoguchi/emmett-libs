/**
 * Base error class for all crypto-shredding related errors
 */
export class CryptoShreddingError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = "CryptoShreddingError";

    // Maintain proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, CryptoShreddingError);
    }
  }
}

/**
 * Error thrown when encryption/decryption operations fail
 */
export class CryptoOperationError extends CryptoShreddingError {
  constructor(
    message: string,
    public readonly operation: "encrypt" | "decrypt",
    public readonly algorithm?: string,
    cause?: Error,
  ) {
    super(message, "CRYPTO_OPERATION_FAILED", cause);
    this.name = "CryptoOperationError";
  }
}

/**
 * Error thrown when an unsupported algorithm is requested
 */
export class UnsupportedAlgorithmError extends CryptoShreddingError {
  constructor(
    public readonly algorithm: string,
    public readonly supportedAlgorithms: string[],
    public readonly runtime?: string,
  ) {
    super(
      `Algorithm "${algorithm}" is not supported in this runtime${runtime ? ` (${runtime})` : ""}. ` +
        `Supported algorithms: ${supportedAlgorithms.join(", ")}`,
      "UNSUPPORTED_ALGORITHM",
    );
    this.name = "UnsupportedAlgorithmError";
  }
}

/**
 * Error thrown when key management operations fail
 */
export class KeyManagementError extends CryptoShreddingError {
  constructor(
    message: string,
    public readonly operation: "get" | "rotate" | "destroy",
    public readonly partition?: string,
    public readonly keyRef?: string,
    cause?: Error,
  ) {
    super(message, "KEY_MANAGEMENT_FAILED", cause);
    this.name = "KeyManagementError";
  }
}

/**
 * Error thrown when policy resolution fails
 */
export class PolicyResolutionError extends CryptoShreddingError {
  constructor(
    message: string,
    public readonly context: {
      partition: string;
      streamId: string;
      streamType?: string;
      eventType?: string;
    },
    cause?: Error,
  ) {
    super(message, "POLICY_RESOLUTION_FAILED", cause);
    this.name = "PolicyResolutionError";
  }
}

/**
 * Error thrown when Web Crypto API is not available
 */
export class WebCryptoNotAvailableError extends CryptoShreddingError {
  constructor(runtime?: string) {
    super(
      `Web Crypto API not available in this environment${runtime ? ` (${runtime})` : ""}`,
      "WEB_CRYPTO_NOT_AVAILABLE",
    );
    this.name = "WebCryptoNotAvailableError";
  }
}

/**
 * Error thrown when invalid parameters are provided
 */
export class InvalidParameterError extends CryptoShreddingError {
  constructor(
    message: string,
    public readonly parameter: string,
    public readonly value: unknown,
  ) {
    super(message, "INVALID_PARAMETER", undefined);
    this.name = "InvalidParameterError";
  }
}

/**
 * Error thrown when data format is invalid
 */
export class InvalidDataFormatError extends CryptoShreddingError {
  constructor(
    message: string,
    public readonly expectedFormat: string,
    public readonly actualFormat?: string,
  ) {
    super(message, "INVALID_DATA_FORMAT", undefined);
    this.name = "InvalidDataFormatError";
  }
}
