import { describe, expect, it } from "vitest";
import { UnsupportedAlgorithmError } from "../errors.js";
import {
  detectRuntimeInfo,
  getBestSupportedAlgorithm,
  isAlgorithmSupported,
  validateAlgorithmSupport,
} from "./runtime-detection.js";

describe("Feature: Runtime Detection", () => {
  describe("Scenario: Detecting Runtime Info", () => {
    it("Given no parameters, When detecting runtime info, Then it should return info with supported algorithms", async () => {
      const info = await detectRuntimeInfo();
      expect(Array.isArray(info.supportedAlgorithms)).toBe(true);
      // In Node 20+/22+, AES-GCM should be supported
      expect(info.supportedAlgorithms).toContain("AES-GCM");
    });
  });

  describe("Scenario: Checking Algorithm Support", () => {
    it("Given AES-GCM algorithm, When checking support, Then it should return true", async () => {
      const ok = await isAlgorithmSupported("AES-GCM");
      expect(ok).toBe(true);
    });
  });

  describe("Scenario: Getting Best Supported Algorithm", () => {
    it("Given no parameters, When getting best supported algorithm, Then it should return a supported algorithm", async () => {
      const best = await getBestSupportedAlgorithm();
      const info = await detectRuntimeInfo();
      expect(info.supportedAlgorithms).toContain(best);
    });
  });

  describe("Scenario: Validating Algorithm Support", () => {
    it("Given invalid algorithm, When validating support, Then it should throw UnsupportedAlgorithmError", async () => {
      await expect(
        validateAlgorithmSupport("NOPE" as any),
      ).rejects.toBeInstanceOf(UnsupportedAlgorithmError);
    });
  });
});
