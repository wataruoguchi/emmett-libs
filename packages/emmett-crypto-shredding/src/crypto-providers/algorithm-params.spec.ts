import { describe, expect, it } from "vitest";
import { UnsupportedAlgorithmError } from "../errors.js";
import {
  getAlgorithmParams,
  getAllSupportedAlgorithms,
  getKeyGenerationParams,
  supportsAdditionalData,
} from "./algorithm-params.js";

describe("Feature: Algorithm Parameters", () => {
  describe("Scenario: Getting Algorithm Parameters", () => {
    it("Given AES-GCM algorithm, When getting params, Then it should return params with tagLength 128", () => {
      const params = getAlgorithmParams("AES-GCM");
      expect(params).toEqual({ name: "AES-GCM", tagLength: 128 });
    });

    it("Given AES-CBC algorithm, When getting params, Then it should return params without tagLength", () => {
      expect(getAlgorithmParams("AES-CBC")).toEqual({ name: "AES-CBC" });
    });

    it("Given AES-CTR algorithm, When getting params, Then it should return params without tagLength", () => {
      expect(getAlgorithmParams("AES-CTR")).toEqual({ name: "AES-CTR" });
    });
  });

  describe("Scenario: Listing Supported Algorithms", () => {
    it("Given no parameters, When getting all supported algorithms, Then it should return list of all algorithms", () => {
      const list = getAllSupportedAlgorithms();
      expect(list).toEqual(["AES-GCM", "AES-CBC", "AES-CTR"]);
    });
  });

  describe("Scenario: Key Generation Parameters", () => {
    it("Given AES-GCM algorithm, When getting key generation params, Then it should return params with length", () => {
      const gcm = getKeyGenerationParams("AES-GCM") as AesKeyGenParams;
      expect(gcm.name).toBe("AES-GCM");
      expect(gcm.length).toBeTypeOf("number");
    });
  });

  describe("Scenario: Additional Authenticated Data Support", () => {
    it("Given AES-GCM algorithm, When checking AAD support, Then it should return true", () => {
      expect(supportsAdditionalData("AES-GCM")).toBe(true);
    });

    it("Given AES-CBC algorithm, When checking AAD support, Then it should return false", () => {
      expect(supportsAdditionalData("AES-CBC")).toBe(false);
    });

    it("Given AES-CTR algorithm, When checking AAD support, Then it should return false", () => {
      expect(supportsAdditionalData("AES-CTR")).toBe(false);
    });
  });

  describe("Scenario: Error Handling", () => {
    it("Given unknown algorithm, When getting algorithm params, Then it should throw UnsupportedAlgorithmError", () => {
      expect(() => getAlgorithmParams("NOPE" as any)).toThrowError(
        UnsupportedAlgorithmError,
      );
    });

    it("Given unknown algorithm, When getting key generation params, Then it should throw UnsupportedAlgorithmError", () => {
      expect(() => getKeyGenerationParams("NOPE" as any)).toThrowError(
        UnsupportedAlgorithmError,
      );
    });
  });
});
