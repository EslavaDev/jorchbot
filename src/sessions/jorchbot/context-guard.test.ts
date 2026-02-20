import { describe, expect, it } from "vitest";
import {
  DEFAULT_BLOCK_PERCENT,
  DEFAULT_CONTEXT_LIMIT,
  DEFAULT_CRITICAL_PERCENT,
  DEFAULT_WARN_PERCENT,
  evaluateContextGuard,
  resolveContextInfo,
} from "./context-guard.js";

describe("context-guard", () => {
  describe("exported defaults", () => {
    it("has expected default values", () => {
      expect(DEFAULT_WARN_PERCENT).toBe(70);
      expect(DEFAULT_CRITICAL_PERCENT).toBe(90);
      expect(DEFAULT_BLOCK_PERCENT).toBe(95);
      expect(DEFAULT_CONTEXT_LIMIT).toBe(200_000);
    });
  });

  describe("resolveContextInfo()", () => {
    it("computes percentage from input + output tokens", () => {
      const info = resolveContextInfo({ inputTokens: 100_000, outputTokens: 50_000 });
      expect(info.percent).toBe(75);
      expect(info.totalTokens).toBe(150_000);
      expect(info.contextLimit).toBe(200_000);
    });

    it("uses default context limit when not provided", () => {
      const info = resolveContextInfo({ inputTokens: 0, outputTokens: 0 });
      expect(info.contextLimit).toBe(DEFAULT_CONTEXT_LIMIT);
    });

    it("uses custom context limit", () => {
      const info = resolveContextInfo({
        inputTokens: 50_000,
        outputTokens: 50_000,
        contextLimit: 100_000,
      });
      expect(info.percent).toBe(100);
      expect(info.contextLimit).toBe(100_000);
    });

    it("returns 0% for zero tokens", () => {
      const info = resolveContextInfo({ inputTokens: 0, outputTokens: 0 });
      expect(info.percent).toBe(0);
      expect(info.totalTokens).toBe(0);
    });

    it("clamps percentage to 100", () => {
      const info = resolveContextInfo({
        inputTokens: 200_000,
        outputTokens: 100_000,
        contextLimit: 200_000,
      });
      expect(info.percent).toBe(100);
    });

    it("rounds percentage to nearest integer", () => {
      // 33,333 / 200,000 = 16.6665 → rounds to 17
      const info = resolveContextInfo({ inputTokens: 30_000, outputTokens: 3_333 });
      expect(info.percent).toBe(17);
    });

    it("handles zero context limit gracefully", () => {
      const info = resolveContextInfo({
        inputTokens: 100,
        outputTokens: 100,
        contextLimit: 0,
      });
      expect(info.percent).toBe(0);
    });
  });

  describe("evaluateContextGuard()", () => {
    it("returns ok level below warn threshold", () => {
      const info = resolveContextInfo({ inputTokens: 50_000, outputTokens: 10_000 });
      const result = evaluateContextGuard({ info });
      expect(result.level).toBe("ok");
      expect(result.shouldWarn).toBe(false);
      expect(result.shouldBlock).toBe(false);
      expect(result.message).toBeNull();
    });

    it("returns warn level at exactly warn threshold", () => {
      const info = resolveContextInfo({ inputTokens: 120_000, outputTokens: 20_000 });
      expect(info.percent).toBe(70);
      const result = evaluateContextGuard({ info });
      expect(result.level).toBe("warn");
      expect(result.shouldWarn).toBe(true);
      expect(result.shouldBlock).toBe(false);
      expect(result.message).toContain("70%");
    });

    it("returns warn level between warn and critical", () => {
      const info = resolveContextInfo({ inputTokens: 140_000, outputTokens: 20_000 });
      expect(info.percent).toBe(80);
      const result = evaluateContextGuard({ info });
      expect(result.level).toBe("warn");
      expect(result.shouldWarn).toBe(true);
      expect(result.shouldBlock).toBe(false);
    });

    it("returns critical level at exactly critical threshold", () => {
      const info = resolveContextInfo({ inputTokens: 160_000, outputTokens: 20_000 });
      expect(info.percent).toBe(90);
      const result = evaluateContextGuard({ info });
      expect(result.level).toBe("critical");
      expect(result.shouldWarn).toBe(true);
      expect(result.shouldBlock).toBe(false);
      expect(result.message).toContain("90%");
      expect(result.message).toContain("/compact");
    });

    it("returns critical level between critical and block", () => {
      const info = resolveContextInfo({ inputTokens: 165_000, outputTokens: 20_000 });
      expect(info.percent).toBe(93);
      const result = evaluateContextGuard({ info });
      expect(result.level).toBe("critical");
    });

    it("returns block level at exactly block threshold", () => {
      const info = resolveContextInfo({ inputTokens: 170_000, outputTokens: 20_000 });
      expect(info.percent).toBe(95);
      const result = evaluateContextGuard({ info });
      expect(result.level).toBe("block");
      expect(result.shouldWarn).toBe(false);
      expect(result.shouldBlock).toBe(true);
      expect(result.message).toContain("95%");
      expect(result.message).toContain("limit reached");
      expect(result.message).toContain("/compact");
    });

    it("returns block level above block threshold", () => {
      const info = resolveContextInfo({ inputTokens: 190_000, outputTokens: 10_000 });
      expect(info.percent).toBe(100);
      const result = evaluateContextGuard({ info });
      expect(result.level).toBe("block");
      expect(result.shouldBlock).toBe(true);
    });

    it("includes project prefix in messages", () => {
      const info = resolveContextInfo({ inputTokens: 160_000, outputTokens: 20_000 });
      const result = evaluateContextGuard({ info, project: "frontend" });
      expect(result.message).toMatch(/^\[frontend\]/);
    });

    it("omits project prefix when not provided", () => {
      const info = resolveContextInfo({ inputTokens: 160_000, outputTokens: 20_000 });
      const result = evaluateContextGuard({ info });
      expect(result.message).toMatch(/^Context/);
    });

    it("respects custom thresholds", () => {
      // At 50% with custom thresholds: warn=40, critical=60, block=80
      const info = resolveContextInfo({ inputTokens: 80_000, outputTokens: 20_000 });
      expect(info.percent).toBe(50);

      const result = evaluateContextGuard({
        info,
        thresholds: { warnPercent: 40, criticalPercent: 60, blockPercent: 80 },
      });
      expect(result.level).toBe("warn");
    });

    it("blocks at custom block threshold", () => {
      const info = resolveContextInfo({ inputTokens: 120_000, outputTokens: 40_000 });
      expect(info.percent).toBe(80);

      const result = evaluateContextGuard({
        info,
        thresholds: { warnPercent: 40, criticalPercent: 60, blockPercent: 80 },
      });
      expect(result.level).toBe("block");
      expect(result.shouldBlock).toBe(true);
    });

    it("returns ok at 0%", () => {
      const info = resolveContextInfo({ inputTokens: 0, outputTokens: 0 });
      const result = evaluateContextGuard({ info });
      expect(result.level).toBe("ok");
      expect(result.message).toBeNull();
    });

    it("preserves info fields in result", () => {
      const info = resolveContextInfo({ inputTokens: 100_000, outputTokens: 50_000 });
      const result = evaluateContextGuard({ info });
      expect(result.percent).toBe(info.percent);
      expect(result.totalTokens).toBe(info.totalTokens);
      expect(result.contextLimit).toBe(info.contextLimit);
    });
  });
});
