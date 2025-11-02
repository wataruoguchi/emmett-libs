# Crypto Providers

This directory contains crypto provider implementations and utilities for the `@wataruoguchi/emmett-crypto-shredding` package.

## Structure

### Core Providers

- **`web-crypto.ts`** - Web Crypto API implementation (`createWebCryptoProvider`)

### Algorithm Utilities

- **`algorithm-params.ts`** - Algorithm parameter definitions and utilities
  - `getAlgorithmParams()` - Get Web Crypto API parameters for encryption/decryption
  - `getKeyGenerationParams()` - Get Web Crypto API parameters for key generation
  - `supportsAdditionalData()` - Check if algorithm supports AAD
  - `getAllSupportedAlgorithms()` - Get list of all supported algorithms
  - `AlgorithmParams` interface

### Runtime Detection

- **`runtime-detection.ts`** - Runtime environment detection and algorithm support
  - `isAlgorithmSupported()` - Test if specific algorithm is supported
  - `detectRuntimeInfo()` - Detect runtime environment and supported algorithms
  - `getBestSupportedAlgorithm()` - Get the best supported algorithm for current runtime
  - `validateAlgorithmSupport()` - Validate algorithm support with error messages
  - `RuntimeInfo` interface

## Responsibilities

### `algorithm-params.ts`

- **Single Responsibility**: Algorithm parameter mapping
- **Focus**: Converting `SupportedAlgorithm` to Web Crypto API parameters
- **No Dependencies**: Pure functions with no external dependencies

### `runtime-detection.ts`

- **Single Responsibility**: Runtime environment detection
- **Focus**: Testing algorithm support in current environment
- **Dependencies**: Uses `algorithm-params.ts` for key generation parameters

### `web-crypto.ts`

- **Single Responsibility**: Web Crypto API provider implementation
- **Focus**: Actual encryption/decryption operations
- **Dependencies**: Uses both `algorithm-params.ts` and `runtime-detection.ts`

## Usage

```typescript
import { 
  createWebCryptoProvider,
  getAlgorithmParams,
  detectRuntimeInfo,
  validateAlgorithmSupport,
  getDefaultPolicies,
} from '@wataruoguchi/emmett-crypto-shredding';

// Create crypto provider
const crypto = createWebCryptoProvider();

// Get algorithm parameters
const params = getAlgorithmParams('AES-GCM');

// Detect runtime capabilities
const runtime = await detectRuntimeInfo();

// Validate algorithm support
await validateAlgorithmSupport('AES-GCM');
```