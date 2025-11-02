import { describe, expect, it } from "vitest";
import {
  CryptoOperationError,
  CryptoShreddingError,
  InvalidDataFormatError,
  InvalidParameterError,
  KeyManagementError,
  PolicyResolutionError,
  UnsupportedAlgorithmError,
  WebCryptoNotAvailableError,
} from "./errors.js";

describe("Feature: Custom Error Types", () => {
  describe("Scenario: Base Error", () => {
    it("Given message, code, and cause, When creating CryptoShreddingError, Then it should set all properties correctly", () => {
      const cause = new Error("root");
      const err = new CryptoShreddingError("msg", "CODE", cause);
      expect(err.name).toBe("CryptoShreddingError");
      expect(err.code).toBe("CODE");
      expect(err.cause).toBe(cause);
    });
  });

  describe("Scenario: Crypto Operation Error", () => {
    it("Given operation and algorithm, When creating CryptoOperationError, Then it should set properties correctly", () => {
      const err = new CryptoOperationError("fail", "encrypt", "AES-GCM");
      expect(err.name).toBe("CryptoOperationError");
      expect(err.code).toBe("CRYPTO_OPERATION_FAILED");
      expect(err.operation).toBe("encrypt");
      expect(err.algorithm).toBe("AES-GCM");
    });
  });

  describe("Scenario: Unsupported Algorithm Error", () => {
    it("Given algorithm, supported algorithms, and runtime, When creating UnsupportedAlgorithmError, Then it should set properties correctly", () => {
      const err = new UnsupportedAlgorithmError("BAD", ["AES-GCM"], "v22");
      expect(err.name).toBe("UnsupportedAlgorithmError");
      expect(err.code).toBe("UNSUPPORTED_ALGORITHM");
      expect(err.algorithm).toBe("BAD");
      expect(err.supportedAlgorithms).toEqual(["AES-GCM"]);
      expect(err.runtime).toBe("v22");
      expect(err.message).toContain("BAD");
    });
  });

  describe("Scenario: Key Management Error", () => {
    it("Given operation, partition, and keyRef, When creating KeyManagementError, Then it should set properties correctly", () => {
      const err = new KeyManagementError("km fail", "rotate", "p1", "ref1");
      expect(err.name).toBe("KeyManagementError");
      expect(err.code).toBe("KEY_MANAGEMENT_FAILED");
      expect(err.operation).toBe("rotate");
      expect(err.partition).toBe("p1");
      expect(err.keyRef).toBe("ref1");
    });
  });

  describe("Scenario: Policy Resolution Error", () => {
    it("Given message and context, When creating PolicyResolutionError, Then it should set properties correctly", () => {
      const err = new PolicyResolutionError("pr fail", {
        partition: "p",
        streamId: "s",
      });
      expect(err.name).toBe("PolicyResolutionError");
      expect(err.code).toBe("POLICY_RESOLUTION_FAILED");
      expect(err.context.partition).toBe("p");
      expect(err.context.streamId).toBe("s");
    });
  });

  describe("Scenario: Web Crypto Not Available Error", () => {
    it("Given runtime, When creating WebCryptoNotAvailableError, Then it should set properties correctly", () => {
      const err = new WebCryptoNotAvailableError("v22");
      expect(err.name).toBe("WebCryptoNotAvailableError");
      expect(err.code).toBe("WEB_CRYPTO_NOT_AVAILABLE");
      expect(err.message).toContain("Web Crypto API not available");
    });
  });

  describe("Scenario: Invalid Parameter Error", () => {
    it("Given parameter name and value, When creating InvalidParameterError, Then it should set properties correctly", () => {
      const err = new InvalidParameterError("bad", "len", 1);
      expect(err.name).toBe("InvalidParameterError");
      expect(err.code).toBe("INVALID_PARAMETER");
      expect(err.parameter).toBe("len");
      expect(err.value).toBe(1);
    });
  });

  describe("Scenario: Invalid Data Format Error", () => {
    it("Given expected and actual format, When creating InvalidDataFormatError, Then it should set properties correctly", () => {
      const err = new InvalidDataFormatError("fmt", "base64", "json");
      expect(err.name).toBe("InvalidDataFormatError");
      expect(err.code).toBe("INVALID_DATA_FORMAT");
      expect(err.expectedFormat).toBe("base64");
      expect(err.actualFormat).toBe("json");
    });
  });
});
